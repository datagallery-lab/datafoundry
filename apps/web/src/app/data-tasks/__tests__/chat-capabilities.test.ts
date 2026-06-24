import { describe, expect, it } from "vitest";
import {
  applyBackendCapabilities,
  resetCapabilitiesForTests,
} from "../../../lib/config-api/capabilities";

describe("chat attachment capabilities", () => {
  it("defaults chat.imageInput and chat.fileUpload to false", () => {
    resetCapabilitiesForTests();
    const mapped = applyBackendCapabilities({});
    expect(mapped["chat.imageInput"]).toBe(false);
    expect(mapped["chat.fileUpload"]).toBe(false);
  });

  it("maps backend response flags through", () => {
    const mapped = applyBackendCapabilities({
      "chat.imageInput": true,
      "chat.fileUpload": true,
    });
    expect(mapped["chat.imageInput"]).toBe(true);
    expect(mapped["chat.fileUpload"]).toBe(true);
  });
});
