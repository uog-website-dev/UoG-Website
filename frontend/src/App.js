import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const apiUrl = process.env.REACT_APP_API_URL || '/api';

  useEffect(() => {
    const fetchPage = async () => {
      try {
        const response = await axios.get(
          `${apiUrl}/pages/home/`,
          { timeout: 5000 }
        );
        setPage(response.data);
      } catch (err) {
        setError(err.message);
        console.error('Error fetching page:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPage();
  }, []);

  return (
    <div className="App">
      <div className="container">
        <div className="content">
          <div className="header">
            <h1>UoG Website</h1>
            <p className="tagline">Elegant & Fancy</p>
          </div>

          {loading && (
            <div className="loading">
              <div className="spinner"></div>
              <p>Loading...</p>
            </div>
          )}

          {page && (
            <div className="page-content">
              <div
                className="content-html"
                dangerouslySetInnerHTML={{ __html: page.content }}
              />
              {page.description && (
                <p className="description">{page.description}</p>
              )}
            </div>
          )}

          <div className="placeholder">
            <div className="feature-box">
              <div className="feature-icon">🎨</div>
              <h3>Beautiful Design</h3>
              <p>Elegant and modern interface for a premium experience</p>
            </div>

            <div className="feature-box">
              <div className="feature-icon">⚡</div>
              <h3>Fast & Responsive</h3>
              <p>Optimized performance with React and Django</p>
            </div>

            <div className="feature-box">
              <div className="feature-icon">🔒</div>
              <h3>Secure</h3>
              <p>Built with security best practices in mind</p>
            </div>

            <div className="feature-box">
              <div className="feature-icon">📦</div>
              <h3>Docker Ready</h3>
              <p>Easy deployment with Docker Compose</p>
            </div>
          </div>

          <div className="footer">
            <p>🚀 Proof of Concept - Full Stack Demo</p>
            <p>Django Backend • React Frontend • PostgreSQL Database</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
