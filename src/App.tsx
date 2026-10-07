import { BrowserRouter, Route, Routes } from "react-router-dom";
import AppShell from "./layouts/AppShell";
import Home from "./pages/Home";
import Contribute from "./pages/Contribute";
import Stub from "./pages/Stub";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="contribute" element={<Contribute />} />
          <Route
            path="dashboard"
            element={
              <Stub title="大盘">
                这里要放邀请码的新增与消费趋势，按天画两条线加一条净量。它服务的是「供需有没有失衡」，
                不是给单个用户看的，所以不会堆图表。
              </Stub>
            }
          />
          <Route
            path="admin"
            element={
              <Stub title="管理员">
                固定账号登录。后台只管三件事：新增应用分类、删除应用分类、审批别人提交的新分类。
                管理员不删邀请码。
              </Stub>
            }
          />
          <Route
            path="*"
            element={<Stub title="没有这个页面">地址可能拼错了，或者这个页面还没做。</Stub>}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
