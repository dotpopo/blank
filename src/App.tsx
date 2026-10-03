import { BrowserRouter, Route, Routes } from "react-router-dom";
import Toast from "@/components/Toast";
import AdminPage from "@/pages/AdminPage";
import HomePage from "@/pages/HomePage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
      <Toast />
    </BrowserRouter>
  );
}
