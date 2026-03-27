import { _cloneRichTextArray } from "../converters/rich-text.mjs";

/** Extract readable title from a Notion page object */
export function extractTitle(page) {
  const props = page.properties || {};
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      return (prop.title || []).map((t) => t.plain_text || "").join("") || "Untitled";
    }
  }
  return "Untitled";
}

/** Extract readable title from a Notion database object */
export function extractDbTitle(db) {
  return (db.title || []).map((t) => t.plain_text || "").join("") || "Untitled";
}

/** Convert any Notion property type to human-readable string (20 types) */
export function extractPropertyValue(prop) {
  const t = prop?.type;
  if (!t) return "";
  switch (t) {
    case "title":
      return (prop.title || []).map((r) => r.plain_text).join("");
    case "rich_text":
      return (prop.rich_text || []).map((r) => r.plain_text).join("");
    case "number":
      return prop.number != null ? String(prop.number) : "";
    case "select":
      return prop.select?.name ?? "";
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name).join(", ");
    case "date":
      return prop.date?.start ?? "";
    case "checkbox":
      return String(prop.checkbox);
    case "url":
      return prop.url ?? "";
    case "email":
      return prop.email ?? "";
    case "phone_number":
      return prop.phone_number ?? "";
    case "status":
      return prop.status?.name ?? "";
    case "relation":
      return (prop.relation || []).map((r) => r.id.replace(/-/g, "").slice(-4)).join(", ");
    case "formula":
      return prop.formula?.[prop.formula?.type] != null ? String(prop.formula[prop.formula.type]) : "";
    case "rollup": {
      const s = JSON.stringify(prop.rollup);
      return s.length > 80 ? `${s.slice(0, 79)}\u2026` : s;
    }
    case "people":
      return (prop.people || []).map((p) => p.name || p.id).join(", ");
    case "created_time":
      return prop.created_time ?? "";
    case "last_edited_time":
      return prop.last_edited_time ?? "";
    case "created_by":
      return prop.created_by?.name ?? "";
    case "last_edited_by":
      return prop.last_edited_by?.name ?? "";
    default:
      return JSON.stringify(prop[t] ?? "");
  }
}

/** Build typed Notion property objects from simple values (11 types) */
export function buildPropertyValue(type, value) {
  switch (type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "rich_text":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: Number(value) };
    case "select":
      return { select: { name: String(value) } };
    case "multi_select":
      return { multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({ name: String(v) })) };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: String(value) };
    case "email":
      return { email: String(value) };
    case "date":
      return { date: { start: String(value) } };
    case "status":
      return { status: { name: String(value) } };
    case "relation":
      return { relation: (Array.isArray(value) ? value : [value]).map((v) => ({ id: String(v) })) };
    default:
      return {};
  }
}

/** Clone a property value from API response to request shape (bypasses buildPropertyValue) */
export function clonePropertyValue(prop) {
  const type = prop?.type;
  if (!type) return undefined;
  switch (type) {
    case "title":
      return { title: _cloneRichTextArray(prop.title) };
    case "rich_text":
      return { rich_text: _cloneRichTextArray(prop.rich_text) };
    case "number":
      return prop.number != null ? { number: prop.number } : undefined;
    case "select":
      return prop.select ? { select: { name: prop.select.name } } : undefined;
    case "multi_select":
      return { multi_select: (prop.multi_select || []).map((s) => ({ name: s.name })) };
    case "checkbox":
      return { checkbox: prop.checkbox };
    case "url":
      return prop.url != null ? { url: prop.url } : undefined;
    case "email":
      return prop.email != null ? { email: prop.email } : undefined;
    case "phone_number":
      return prop.phone_number != null ? { phone_number: prop.phone_number } : undefined;
    case "status":
      return prop.status ? { status: { name: prop.status.name } } : undefined;
    case "date":
      return prop.date ? { date: prop.date } : undefined;
    case "people":
      return prop.people?.length ? { people: prop.people.map((p) => ({ id: p.id })) } : undefined;
    default:
      return undefined;
  }
}
