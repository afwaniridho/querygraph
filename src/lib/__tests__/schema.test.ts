import { describe, expect, it } from "vitest";
import { parseSchema } from "#/lib/schema/parse-schema";
import { getTable } from "#/lib/schema/schema";

describe("postgres schema extraction", () => {
	it("reads columns, inline PK and NOT NULL", () => {
		const { schema, error } = parseSchema(
			`CREATE TABLE customers (
        id serial PRIMARY KEY,
        email varchar(255) NOT NULL,
        name text
      );`,
			"postgres",
		);
		expect(error).toBeUndefined();
		const t = getTable(schema, "customers");
		expect(t).toBeDefined();
		expect(t?.columns.map((c) => c.name)).toEqual(["id", "email", "name"]);
		expect(t?.primaryKey).toEqual(["id"]);
		expect(t?.columns.find((c) => c.name === "email")?.notNull).toBe(true);
	});

	it("reads inline UNIQUE and inline REFERENCES as a foreign key", () => {
		const { schema } = parseSchema(
			`CREATE TABLE customers (
        id int PRIMARY KEY,
        email varchar(255) UNIQUE,
        org_id int REFERENCES orgs(id)
      );`,
			"postgres",
		);
		const t = getTable(schema, "customers");
		expect(t?.uniques).toContainEqual(["email"]);
		expect(t?.foreignKeys).toContainEqual({
			columns: ["org_id"],
			refTable: "orgs",
			refColumns: ["id"],
		});
	});

	it("reads table-level composite PK, FK and UNIQUE", () => {
		const { schema } = parseSchema(
			`CREATE TABLE orders (
        id int,
        customer_id int NOT NULL,
        placed_at timestamp,
        PRIMARY KEY (id),
        CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customers(id),
        UNIQUE (customer_id, placed_at)
      );`,
			"postgres",
		);
		const t = getTable(schema, "orders");
		expect(t?.primaryKey).toEqual(["id"]);
		expect(t?.uniques).toContainEqual(["customer_id", "placed_at"]);
		expect(t?.foreignKeys[0]).toEqual({
			columns: ["customer_id"],
			refTable: "customers",
			refColumns: ["id"],
		});
	});

	it("reads CREATE INDEX and CREATE UNIQUE INDEX", () => {
		const { schema } = parseSchema(
			`CREATE TABLE orders (id int, customer_id int, placed_at timestamp);
       CREATE INDEX idx_cust ON orders (customer_id, placed_at);
       CREATE UNIQUE INDEX idx_one ON orders (id);`,
			"postgres",
		);
		const t = getTable(schema, "orders");
		const idx = t?.indexes.find((i) => i.name === "idx_cust");
		expect(idx?.columns).toEqual(["customer_id", "placed_at"]);
		expect(idx?.unique).toBe(false);
		const uniq = t?.indexes.find((i) => i.name === "idx_one");
		expect(uniq?.unique).toBe(true);
	});

	it("applies ALTER TABLE ADD CONSTRAINT to an existing table", () => {
		const { schema } = parseSchema(
			`CREATE TABLE orders (id int, total numeric);
       ALTER TABLE orders ADD CONSTRAINT uq_total UNIQUE (total);`,
			"postgres",
		);
		const t = getTable(schema, "orders");
		expect(t?.uniques).toContainEqual(["total"]);
	});

	it("synthesizes a PRIMARY index from the primary key", () => {
		const { schema } = parseSchema(
			`CREATE TABLE t (id int PRIMARY KEY, x int);`,
			"postgres",
		);
		const t = getTable(schema, "t");
		const pk = t?.indexes.find((i) => i.origin === "primary");
		expect(pk?.columns).toEqual(["id"]);
		expect(pk?.unique).toBe(true);
	});

	it("returns an empty schema for blank DDL", () => {
		const { schema, error } = parseSchema("", "postgres");
		expect(error).toBeUndefined();
		expect(schema.tables.size).toBe(0);
	});

	it("reports an error for malformed DDL without throwing", () => {
		const { schema, error } = parseSchema("CREATE TABLE (", "postgres");
		expect(error).toBeDefined();
		expect(schema.tables.size).toBe(0);
	});

	it("looks tables up case-insensitively", () => {
		const { schema } = parseSchema(
			`CREATE TABLE Customers (id int PRIMARY KEY);`,
			"postgres",
		);
		expect(getTable(schema, "CUSTOMERS")).toBeDefined();
		expect(getTable(schema, "customers")).toBeDefined();
	});
});

describe("mysql schema extraction", () => {
	it("reads columns, PRIMARY KEY, UNIQUE KEY, KEY and FK", () => {
		const { schema, error } = parseSchema(
			`CREATE TABLE orders (
        id INT NOT NULL AUTO_INCREMENT,
        customer_id INT NOT NULL,
        placed_at DATETIME,
        email VARCHAR(255),
        PRIMARY KEY (id),
        UNIQUE KEY uq_email (email),
        KEY idx_cust (customer_id, placed_at),
        CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customers(id)
      );`,
			"mysql",
		);
		expect(error).toBeUndefined();
		const t = getTable(schema, "orders");
		expect(t?.columns.map((c) => c.name)).toEqual([
			"id",
			"customer_id",
			"placed_at",
			"email",
		]);
		expect(t?.primaryKey).toEqual(["id"]);
		expect(t?.uniques).toContainEqual(["email"]);
		const idx = t?.indexes.find((i) => i.name === "idx_cust");
		expect(idx?.columns).toEqual(["customer_id", "placed_at"]);
		expect(t?.foreignKeys[0]).toEqual({
			columns: ["customer_id"],
			refTable: "customers",
			refColumns: ["id"],
		});
	});

	it("reads an inline column PRIMARY KEY", () => {
		const { schema } = parseSchema(
			"CREATE TABLE t (id INT PRIMARY KEY, x INT);",
			"mysql",
		);
		const t = getTable(schema, "t");
		expect(t?.primaryKey).toEqual(["id"]);
	});

	it("reads a standalone CREATE INDEX", () => {
		const { schema } = parseSchema(
			`CREATE TABLE orders (id INT, customer_id INT);
       CREATE INDEX idx_cust ON orders (customer_id);`,
			"mysql",
		);
		const t = getTable(schema, "orders");
		expect(t?.indexes.some((i) => i.columns.join() === "customer_id")).toBe(
			true,
		);
	});

	it("synthesizes a PRIMARY index from the primary key", () => {
		const { schema } = parseSchema(
			"CREATE TABLE t (id INT, PRIMARY KEY (id));",
			"mysql",
		);
		const t = getTable(schema, "t");
		expect(t?.indexes.find((i) => i.origin === "primary")?.columns).toEqual([
			"id",
		]);
	});

	it("returns an empty schema for blank DDL", () => {
		const { schema, error } = parseSchema("   ", "mysql");
		expect(error).toBeUndefined();
		expect(schema.tables.size).toBe(0);
	});

	it("reports an error for malformed DDL without throwing", () => {
		const { schema, error } = parseSchema("CREATE TABLE", "mysql");
		expect(error).toBeDefined();
		expect(schema.tables.size).toBe(0);
	});
});
