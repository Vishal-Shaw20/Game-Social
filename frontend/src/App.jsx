// src/App.jsx
import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import HomePage from "./HomePage.jsx";
import Dashboard from "./components/DashBoard.jsx";
import GameDetails from "./components/GameDetails.jsx";
import LoginPage from "./components/LoginPage.jsx";
import Library from "./components/Library.jsx"
import Social from "./components/Social.jsx"
import UserProfile from "./components/UserProfile";
function App() {
  




  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/game/:id" element={<GameDetails />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<LoginPage />} />
          <Route path="/library" element={<Library />} />
          <Route path="/social" element={<Social />} />
          <Route path="/u/:username" element={<UserProfile />} />
        </Route>

        <Route
          path="*"
          element={<div style={{ padding: 50, color: "#fff" }}>404</div>}
        />
      </Routes>
    </Router>
  );
}

export default App;
