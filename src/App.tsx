import { Routes, Route } from "react-router";
import Home from "./pages/Home";
import Ask from "./pages/Ask";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/ask" element={<Ask />} />
    </Routes>
  );
}
