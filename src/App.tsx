import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppShell from "./layouts/AppShell";
import Home from "./pages/Home";
import Contribute from "./pages/Contribute";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import Stub from "./pages/Stub";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="contribute" element={<Contribute />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="admin" element={<Admin />} />
          <Route
            path="*"
            element={<Stub title="没有这个页面">地址可能拼错了，或者这个页面还没做。</Stub>}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
