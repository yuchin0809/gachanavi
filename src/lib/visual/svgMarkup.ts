import { Fragment, type ReactNode, isValidElement } from "react";

/**
 * GachaVisual（フックを使わない純粋な関数）の要素ツリーを SVG の文字列にする。
 * OGP 画像（next/og）に <img src="data:image/svg+xml…"> として渡すため。react-dom/server は使わない
 */
const KEEP_CAMEL = new Set(["viewBox", "preserveAspectRatio", "patternUnits", "gradientUnits", "gradientTransform", "patternTransform", "clipPathUnits"]);

function attrName(key: string): string {
  if (key === "className") return "class";
  if (KEEP_CAMEL.has(key)) return key;
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function svgMarkup(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return escape(String(node));
  if (Array.isArray(node)) return node.map(svgMarkup).join("");
  if (!isValidElement(node)) return "";
  const { children, ...props } = node.props as Record<string, unknown> & { children?: ReactNode };
  if (node.type === Fragment) return svgMarkup(children);
  if (typeof node.type === "function") return svgMarkup((node.type as (p: unknown) => ReactNode)(node.props));
  const tag = String(node.type);
  const attrs = Object.entries(props)
    .filter(([k, v]) => v !== undefined && v !== null && v !== false && k !== "key" && typeof v !== "function" && typeof v !== "object")
    .map(([k, v]) => ` ${attrName(k)}="${escape(String(v))}"`)
    .join("");
  const xmlns = tag === "svg" ? ' xmlns="http://www.w3.org/2000/svg"' : "";
  return `<${tag}${xmlns}${attrs}>${svgMarkup(children)}</${tag}>`;
}
