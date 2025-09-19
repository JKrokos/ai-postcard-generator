import React, { useState, useEffect } from "react";
import "./App.css";

interface Postcard {
  id: number;
  city: string;
  imageUrl: string;
  prompt: string;
  imageKey: string;
}

function App() {
  const [city, setCity] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [currentPostcard, setCurrentPostcard] = useState<Postcard | null>(null);
  const [gallery, setGallery] = useState<Postcard[]>([]);
  const [activeTab, setActiveTab] = useState<"generator" | "gallery">(
    "generator"
  );
  const [isPostcardSaved, setIsPostcardSaved] = useState(false);

  const API_BASE = "/api";

  useEffect(() => {
    fetchGallery();
  }, []);

  const fetchGallery = async () => {
    try {
      const response = await fetch(`${API_BASE}/gallery`);
      if (
        response.ok &&
        response.headers.get("content-type")?.includes("application/json")
      ) {
        const postcards = await response.json();
        setGallery(postcards);
      } else {
        // API not available, use empty gallery
        console.log("Gallery not available");
        setGallery([]);
      }
    } catch (error) {
      console.log("Gallery not available");
      setGallery([]);
    }
  };

  const generatePrompt = async () => {
    if (!city.trim()) return;

    setIsGenerating(true);
    setGeneratedPrompt("");
    setCurrentPostcard(null);
    setIsPostcardSaved(false);

    try {
      const response = await fetch(`${API_BASE}/generate/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ city: city.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        setGeneratedPrompt(data.prompt);

        // Generate temporary image (not saved to database)
        await generateTempImage(data.city, data.prompt);
      } else {
        console.error("Error generating prompt:", response.statusText);
      }
    } catch (error) {
      console.error("Error generating prompt:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const generateTempImage = async (cityName: string, prompt: string) => {
    try {
      const response = await fetch(`${API_BASE}/generate/temp-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ city: cityName, prompt }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        
        // Convert blob to base64 for saving later
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          const base64Image = base64data.split(',')[1]; // Remove data:image/png;base64, prefix
          
          const postcard: Postcard = {
            id: 0, // Temporary ID
            city: cityName,
            imageUrl: imageUrl,
            prompt: prompt,
            imageKey: "",
          };
          
          // Store base64 data for saving later
          (postcard as any).tempImageData = base64Image;
          setCurrentPostcard(postcard);
        };
        reader.readAsDataURL(blob);
      }
    } catch (error) {
      console.error("Error generating temporary image:", error);
    }
  };

  const generateImage = async (id: number) => {
    try {
      const response = await fetch(`${API_BASE}/generate/image/${id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      });

      if (response.ok) {
        const postcard: Postcard = {
          id,
          city,
          imageUrl: `${API_BASE}/image/${id}`,
          prompt: generatedPrompt,
          imageKey: `${city}-${Date.now()}.png`,
        };
        setCurrentPostcard(postcard);
        fetchGallery();
      }
    } catch (error) {
      console.error("Error generating image:", error);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    generatePrompt();
  };

  const deletePostcard = async (id: number) => {
    if (!confirm("Are you sure you want to delete this postcard?")) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/postcard/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      });

      if (response.ok) {
        // Remove the postcard from the gallery state
        setGallery(gallery.filter((postcard) => postcard.id !== id));

        // If the deleted postcard is currently displayed, clear it
        if (currentPostcard && currentPostcard.id === id) {
          setCurrentPostcard(null);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.message || "Failed to delete postcard");
      }
    } catch (error) {
      console.error("Error deleting postcard:", error);
      alert("Network error. Please try again.");
    }
  };

  const downloadPostcard = async (postcard: Postcard) => {
    try {
      const response = await fetch(postcard.imageUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch image");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${postcard.city}-postcard.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading postcard:", error);
      alert("Failed to download postcard. Please try again.");
    }
  };

  const savePostcard = async () => {
    if (!currentPostcard || !(currentPostcard as any).tempImageData) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/save/postcard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          city: currentPostcard.city,
          prompt: currentPostcard.prompt,
          imageData: (currentPostcard as any).tempImageData,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update the postcard with the saved ID and image URL
        const savedPostcard: Postcard = {
          ...currentPostcard,
          id: data.id,
          imageUrl: `${API_BASE}/image/${data.id}`,
          imageKey: data.imageKey,
        };
        
        setCurrentPostcard(savedPostcard);
        setIsPostcardSaved(true);
        fetchGallery(); // Refresh gallery to show the new postcard
      } else {
        const errorData = await response.json().catch(() => ({}));
        alert(errorData.message || "Failed to save postcard");
      }
    } catch (error) {
      console.error("Error saving postcard:", error);
      alert("Failed to save postcard. Please try again.");
    }
  };

  const regenerateImage = async () => {
    if (!generatedPrompt) return;
    
    setIsGenerating(true);
    setCurrentPostcard(null);
    setIsPostcardSaved(false);

    try {
      // Generate a new prompt first to get a new ID
      const promptResponse = await fetch(`${API_BASE}/generate/prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({ city: city.trim() }),
      });

      if (promptResponse.ok) {
        const data = await promptResponse.json();
        setGeneratedPrompt(data.prompt);

        // Generate temporary image (not saved to database)
        await generateTempImage(data.city, data.prompt);
      } else {
        console.error("Error regenerating prompt:", promptResponse.statusText);
      }
    } catch (error) {
      console.error("Error regenerating image:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🌍 World Postcards</h1>
        <p>Generate AI-powered postcards from any city in the world</p>
      </header>

      <nav className="tab-nav">
        <button
          className={activeTab === "generator" ? "active" : ""}
          onClick={() => setActiveTab("generator")}
        >
          Generate Postcard
        </button>
        <button
          className={activeTab === "gallery" ? "active" : ""}
          onClick={() => setActiveTab("gallery")}
        >
          Gallery ({gallery.length})
        </button>
      </nav>

      {activeTab === "generator" && (
        <div className="generator-section">
          <div className="token-form">
            <label htmlFor="bearer-token">Bearer Token:</label>
            <input
              id="bearer-token"
              type="text"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Enter your bearer token"
              disabled={isGenerating}
            />
          </div>
          <form onSubmit={handleSubmit} className="city-form">
            <div className="input-group">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Enter a city name (e.g., Paris, Tokyo, New York)"
                disabled={isGenerating}
                required
              />
              <button
                type="submit"
                disabled={isGenerating || !city.trim() || !bearerToken.trim()}
              >
                {isGenerating ? "Generating..." : "Generate Postcard"}
              </button>
            </div>
          </form>

          {generatedPrompt && (
            <div className="prompt-display">
              <h3>Generated Prompt:</h3>
              <p>{generatedPrompt}</p>
            </div>
          )}

          {currentPostcard && (
            <div className="postcard-preview">
              <h3>Your New Postcard:</h3>
              <div className="postcard">
                <img
                  src={currentPostcard.imageUrl}
                  alt={`Postcard of ${currentPostcard.city}`}
                />
                <div className="postcard-info">
                  <h4>{currentPostcard.city}</h4>
                  <p className="postcard-prompt">{currentPostcard.prompt}</p>
                </div>
              </div>
              
              {!isPostcardSaved && (
                <div className="postcard-actions">
                  <button
                    className="save-button"
                    onClick={savePostcard}
                    disabled={isGenerating}
                  >
                    💾 Save Postcard
                  </button>
                  <button
                    className="regenerate-button"
                    onClick={regenerateImage}
                    disabled={isGenerating}
                  >
                    🔄 Regenerate
                  </button>
                </div>
              )}
              
              {isPostcardSaved && (
                <div className="postcard-saved">
                  <p>✅ Postcard saved to gallery!</p>
                </div>
              )}
            </div>
          )}

          {isGenerating && (
            <div className="loading">
              <div className="spinner"></div>
              <p>Generating your postcard...</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "gallery" && (
        <div className="gallery-section">
          <h2>Postcard Gallery</h2>
          {gallery.length === 0 ? (
            <p className="empty-gallery">
              No postcards yet. Generate your first one!
            </p>
          ) : (
            <div className="gallery-grid">
              {gallery.map((postcard) => (
                <div key={postcard.id} className="gallery-item">
                  <img
                    src={postcard.imageUrl}
                    alt={`Postcard of ${postcard.city}`}
                    loading="lazy"
                  />
                  <div className="gallery-info">
                    <h4>{postcard.city}</h4>
                    <p>{postcard.prompt}</p>
                  </div>
                  <button
                    className="download-button"
                    onClick={() => downloadPostcard(postcard)}
                    title="Download postcard"
                  >
                    📥
                  </button>
                  <button
                    className="delete-button"
                    onClick={() => deletePostcard(postcard.id)}
                    title="Delete postcard"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
