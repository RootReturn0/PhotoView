import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("App", () => {
  it("renders the empty collection workspace", () => {
    render(<App />);

    expect(screen.getByText("PhotoView")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全部合集" })).toBeInTheDocument();
    expect(screen.getByText("暂无合集")).toBeInTheDocument();
  });

  it("toggles settings and advanced search panels", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByLabelText("设置")).toBeInTheDocument();
    expect(screen.getByLabelText("主题")).toHaveValue("system");
    expect(screen.getByLabelText("缩略图")).toHaveValue(192);

    await user.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByLabelText("高级搜索")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索格式")).toBeInTheDocument();
  });

  it("keeps browser-preview search inside a safe desktop-only state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "搜索" }), "summer{Enter}");

    expect(screen.getByText("请在桌面应用中搜索")).toBeInTheDocument();
  });
});
