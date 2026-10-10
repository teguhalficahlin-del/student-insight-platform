// Resolve display identities without granting access to other users' account rows.
export async function attachPortalUserLabels(client, rows, relations) {
    const targets = [];
    for (const row of rows) {
        for (const [field, key] of relations) {
            if (row[key]) targets.push([row, field, row[key]]);
        }
    }
    const ids = [...new Set(targets.map(([, , id]) => id))];
    const labels = new Map();
    for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await client.rpc('fn_portal_user_labels', { p_user_ids: ids.slice(i, i + 100) });
        if (error) throw error;
        for (const label of data ?? []) labels.set(label.user_id, label);
    }
    for (const [row, field, id] of targets) row[field] = labels.get(id) ?? null;
    return rows;
}
