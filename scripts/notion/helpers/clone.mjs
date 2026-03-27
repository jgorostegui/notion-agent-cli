/** Clone page icon. Passes through emoji/external/custom_emoji/icon types. File type needs re-upload. */
export function _clonePageIcon(icon) {
  if (!icon) return undefined;
  if (icon.type === "emoji" || icon.type === "external" || icon.type === "custom_emoji" || icon.type === "icon")
    return icon;
  // type === "file": needs _reuploadNotionFile (handled by caller)
  return undefined;
}

/** Clone page cover. Passes through external type. File type needs re-upload via caller. */
export function _clonePageCover(cover) {
  if (!cover) return undefined;
  if (cover.type === "external") return cover;
  // type === "file": needs _reuploadNotionFile (handled by caller)
  return undefined;
}
