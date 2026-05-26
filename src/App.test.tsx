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
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("主题")).toHaveValue("system");
    expect(screen.getByLabelText("缩略图")).toHaveValue(192);

    await user.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByLabelText("高级搜索")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索格式")).toBeInTheDocument();
  });

  it("switches sidebar navigation views", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(screen.getByRole("heading", { name: "收藏合集" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "最近" }));
    expect(screen.getByRole("heading", { name: "最近浏览" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "标签" }));
    expect(screen.getByRole("heading", { name: "标签" })).toBeInTheDocument();
  });

  it("keeps toolbar icon actions named when labels are visually hidden", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "筛选" })).toHaveAttribute("title", "筛选");
    expect(screen.getByRole("button", { name: "搜索" })).toHaveAttribute("title", "搜索");
    expect(screen.getByRole("button", { name: "重复检测" })).toHaveAttribute("title", "重复检测");
    expect(screen.getByRole("button", { name: "同步图库" })).toHaveAttribute("title", "同步图库");
    expect(
      screen
        .getAllByRole("button", { name: "导入文件夹" })
        .some((button) => button.getAttribute("title") === "导入文件夹"),
    ).toBe(true);
  });

  it("keeps browser-preview search inside a safe desktop-only state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "搜索" }), "summer{Enter}");

    expect(screen.getByText("请在桌面应用中搜索")).toBeInTheDocument();
  });
});
