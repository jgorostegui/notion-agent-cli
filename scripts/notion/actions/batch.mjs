import { normalizeId } from "../helpers/ids.mjs";

export const batchMethods = {
  async batchSetProperties(pageIds, props) {
    let updated = 0;
    const errors = [];
    for (const id of pageIds) {
      try {
        await this.setProperties(normalizeId(id), props);
        updated++;
      } catch (e) {
        errors.push({ id, error: String(e) });
      }
    }
    return { success: true, updated, total: pageIds.length, errors };
  },

  async batchArchive(pageIds) {
    const tasks = pageIds.map((id) => () => this.client.pages.update({ page_id: normalizeId(id), archived: true }));
    const results = await this._callBatch(tasks, 5);
    let archived = 0;
    const errors = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].ok) {
        archived++;
      } else {
        errors.push({ id: pageIds[i], error: String(results[i].error) });
      }
    }
    return { success: true, archived, errors };
  },

  async batchTag(pageIds, property, value) {
    return this.batchSetProperties(pageIds, { [property]: { select: { name: value } } });
  },
};
