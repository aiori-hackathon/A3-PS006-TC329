import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(".");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "bun:test") {
    const url = new URL("../tests/bun-test.mjs", import.meta.url).href;
    return {
      format: "module",
      shortCircuit: true,
      url,
    };
  }

  // Handle @/ path alias
  if (specifier.startsWith("@/")) {
    const targetPath = path.join(projectRoot, "src", specifier.slice(2));
    for (const candidate of [
      targetPath,
      targetPath + ".ts",
      targetPath + ".tsx",
      targetPath + ".js",
      targetPath + ".mjs",
      path.join(targetPath, "index.ts"),
      path.join(targetPath, "index.js"),
    ]) {
      try {
        const fileUrl = pathToFileURL(candidate).href;
        return await nextResolve(fileUrl, context);
      } catch {}
    }
  }

  // Handle path extension resolution for local relative/absolute imports without extensions
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err.code === "ERR_MODULE_NOT_FOUND") {
        for (const ext of [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"]) {
          try {
            return await nextResolve(specifier + ext, context);
          } catch {}
        }
      }
      throw err;
    }
  }

  return nextResolve(specifier, context);
}
