import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { env } from "cloudflare:workers";
import type {
  Env,
  AITextResponse,
  AIImageResponse,
  D1Result,
  PostcardRecord,
} from "./types";

const app = new Hono<{ Bindings: Env }>();

// const token = 'Zurich-Is-Awesome'; // In production, use a more secure way to manage tokens
const token = `${env.BEARER_TOKEN}`;

app.use("/api/generate/*", bearerAuth({ token }));
app.use("/api/save/*", bearerAuth({ token }));

app.get("/", (c) => c.text("Hello! This is the Hono API"));

app.post("/api/generate/prompt", async (c) => {
  let imagePrompt: string = "";
  const { city } = (await c.req.json()) as { city: string };

  const response = (await c.env.AI.run("@cf/openai/gpt-oss-20b", {
    input: city,
    instructions:
      "You are an expert prompt engineer. You help the user write prompts that can be used to generate high quality images using AI image generation models.  The style of the image should always be similar to a Postcard. If the user's prompt is not related to image generation, you politely inform them that you can only help with image generation prompts. You only return the detailed prompt. No other text should be returned.",
  })) as AITextResponse;

  // Extracting the AI's message from the response
  if (response && response.output) {
    // Find the AI message in the response
    const aiMessage = response.output.find(
      (item) => item.type === "message" && item.role === "assistant"
    );
    // Extract the text output from the AI message
    if (aiMessage && Array.isArray(aiMessage.content)) {
      imagePrompt =
        aiMessage.content.find((c) => c.type === "output_text")?.text ?? "";
    }
  }

  // Return the generated prompt without saving to database
  return c.json({ prompt: imagePrompt, city });
});

// New endpoint for temporary image generation (not saved to database)
app.post("/api/generate/temp-image", async (c) => {
  const { city, prompt } = (await c.req.json()) as { city: string; prompt: string };

  if (!prompt) {
    return c.json({ message: "Prompt is required" }, 400);
  }

  // Call the Leonardo model to generate an image based on the prompt
  const generateImage = (await c.env.AI.run("@cf/leonardo/lucid-origin", {
    prompt: prompt,
    num_steps: 3,
  })) as AIImageResponse;

  if (!generateImage || !generateImage.image) {
    return c.json({ message: `Failed to generate image` }, 500);
  }

  // The image is returned as a base64-encoded string
  const base64Image = generateImage.image;

  // Return the image buffer as a response without saving
  const buffer = Buffer.from(base64Image, "base64");
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
    },
  });
});

// New endpoint to save postcard to database and R2
app.post("/api/save/postcard", async (c) => {
  const { city, prompt, imageData } = (await c.req.json()) as { 
    city: string; 
    prompt: string; 
    imageData: string; 
  };

  if (!city || !prompt || !imageData) {
    return c.json({ message: "City, prompt, and imageData are required" }, 400);
  }

  const db = c.env.DB;

  try {
    // Store the city and generated prompt in the D1 database
    const result = (await db
      .prepare("INSERT INTO postcards (city, image_prompt) VALUES (?, ?)")
      .bind(city, prompt)
      .run()) as D1Result;

    const postcardId = result?.meta.last_row_id;

    if (!postcardId) {
      return c.json({ message: "Failed to save postcard to database" }, 500);
    }

    // Convert base64 image data to buffer
    const buffer = Buffer.from(imageData, "base64");
    const filename = `${city}-${Date.now()}.png`;

    // Save the image to the R2 bucket
    await c.env.BUCKET.put(filename, buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    // Update the D1 database record with the image key (filename)
    await db
      .prepare("UPDATE postcards SET image_key = ? WHERE id = ?")
      .bind(filename, postcardId)
      .run();

    return c.json({ 
      message: "Postcard saved successfully",
      id: postcardId,
      imageKey: filename
    });
  } catch (error) {
    console.error("Error saving postcard:", error);
    return c.json({ message: "Failed to save postcard" }, 500);
  }
});

app.post("/api/generate/image/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  // Retrieve the image prompt from the D1 database using the provided ID
  const result = await db
    .prepare("SELECT city,image_prompt FROM postcards WHERE id = ?")
    .bind(id)
    .first<{ city: string; image_prompt: string }>();
  if (result && result.image_prompt) {
    // Call the Leonardo model to generate an image based on the prompt
    const generateImage = (await c.env.AI.run("@cf/leonardo/lucid-origin", {
      prompt: result.image_prompt,
      num_steps: 3,
    })) as AIImageResponse;

    if (!generateImage || !generateImage.image) {
      return c.json({ message: `Failed to generate image` }, 500);
    }
    // The image is returned as a base64-encoded string
    const base64Image = generateImage.image;

    // Use the image property from the response
    const buffer = Buffer.from(base64Image, "base64");
    // Create a unique filename for the image
    const filename = `${result.city}-${Date.now()}.png`;

    // Save the image to the R2 bucket
    await c.env.BUCKET.put(filename, buffer, {
      httpMetadata: { contentType: "image/png" },
    });

    // Update the D1 database record with the image key (filename)
    await db
      .prepare("UPDATE postcards SET image_key = ? WHERE id = ?")
      .bind(filename, id)
      .run();

    // Return the image buffer as a response
    return new Response(buffer, {
      status: 200,
    });
  } else {
    return c.json({ message: "Prompt not found" }, 404);
  }
});

app.get(`/api/image/:id`, async (c) => {
  const id = c.req.param("id");

  // Retrieve the image key from the D1 database using the provided ID
  const db = c.env.DB;
  const result = await db
    .prepare("SELECT image_key FROM postcards WHERE id = ?")
    .bind(id)
    .first<{ image_key: string }>();

  if (result && result.image_key) {
    // Fetch the image from the R2 bucket using the image key
    const object = await c.env.BUCKET.get(result.image_key);
    if (object) {
      // Return the image as a response
      return new Response(object.body, {
        headers: {
          "Content-Type":
            object.httpMetadata?.contentType || "application/octet-stream",
        },
      });
    } else {
      return c.json({ message: "Image not found in R2 bucket" }, 404);
    }
  } else {
    return c.json({ message: "Image key not found in database" }, 404);
  }
});

app.get("/api/gallery", async (c) => {
  const db = c.env.DB;
  const results = (await db
    .prepare(
      "SELECT ID, city, image_key, image_prompt FROM postcards WHERE image_key IS NOT NULL ORDER BY ID DESC"
    )
    .all()) as D1Result<PostcardRecord>;

  // Return the list of postcards with image URLs
  const postcards =
    results.results?.map((row: PostcardRecord) => ({
      id: row.ID,
      city: row.city,
      imageUrl: `/api/image/${row.ID}`,
      prompt: row.image_prompt,
      imageKey: row.image_key,
    })) || [];

  return c.json(postcards);
});

// Apply bearer auth to delete endpoint
app.use("/api/postcard/*", bearerAuth({ token }));

app.delete("/api/postcard/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;

  try {
    // First, get the postcard to find the image key
    const postcard = await db
      .prepare("SELECT image_key FROM postcards WHERE id = ?")
      .bind(id)
      .first<{ image_key: string | null }>();

    if (!postcard) {
      return c.json({ message: "Postcard not found" }, 404);
    }

    // Delete the image from R2 bucket if it exists
    if (postcard.image_key) {
      try {
        await c.env.BUCKET.delete(postcard.image_key);
      } catch (error) {
        console.error("Error deleting image from R2:", error);
        // Continue with database deletion even if R2 deletion fails
      }
    }

    // Delete the postcard from the database
    const result = (await db
      .prepare("DELETE FROM postcards WHERE id = ?")
      .bind(id)
      .run()) as D1Result;

    if (result.meta.changes === 0) {
      return c.json({ message: "Postcard not found" }, 404);
    }

    return c.json({ 
      message: "Postcard deleted successfully",
      deletedId: parseInt(id)
    });
  } catch (error) {
    console.error("Error deleting postcard:", error);
    return c.json({ message: "Failed to delete postcard" }, 500);
  }
});

export default app;
