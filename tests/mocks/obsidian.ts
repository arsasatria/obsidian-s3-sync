import { vi } from "vitest";

export const Platform = {
  isMobileApp: false,
};

export const requestUrl = vi.fn(async () => ({
  arrayBuffer: new ArrayBuffer(0),
  headers: {},
  json: {},
  status: 200,
  text: "",
}));
