import type pg from "pg";

export const healthRepository = {
  ping: async (pool: pg.Pool): Promise<void> => {
    await pool.query("select 1 as ok");
  },
};
