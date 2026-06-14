// Types for the drizzle-kit generated `migrations.js` bundle (which imports the
// raw .sql files inlined by babel-plugin-inline-import at build time). Shaped to
// satisfy drizzle-orm/expo-sqlite/migrator's `migrate()`.
declare const migrations: {
  journal: {
    entries: {
      idx: number;
      when: number;
      tag: string;
      breakpoints: boolean;
    }[];
  };
  migrations: Record<string, string>;
};

export default migrations;
