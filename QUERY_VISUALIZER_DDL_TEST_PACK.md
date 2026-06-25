# Query Visualizer DDL Test Pack

Use this file to test schema-aware query visualization. Paste one DDL block into **Schema DDL** first, then paste one query at a time into the SQL editor.

## PostgreSQL DDL

Select **PostgreSQL** in the app before using this block.

```sql
CREATE TABLE regions (
  id int PRIMARY KEY,
  code varchar(20) NOT NULL UNIQUE,
  name varchar(120) NOT NULL
);

CREATE TABLE customers (
  id int PRIMARY KEY,
  region_id int NOT NULL REFERENCES regions(id),
  email varchar(255) NOT NULL UNIQUE,
  status varchar(20) NOT NULL,
  first_name varchar(80) NOT NULL,
  last_name varchar(80) NOT NULL,
  created_at timestamp NOT NULL,
  last_login_at timestamp
);

CREATE TABLE addresses (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  address_type varchar(20) NOT NULL,
  city varchar(120) NOT NULL,
  country_code varchar(2) NOT NULL,
  postal_code varchar(20),
  CONSTRAINT fk_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  UNIQUE (customer_id, address_type)
);

CREATE TABLE products (
  id int PRIMARY KEY,
  sku varchar(64) NOT NULL UNIQUE,
  name varchar(160) NOT NULL,
  category varchar(80) NOT NULL,
  price numeric NOT NULL,
  active boolean NOT NULL
);

CREATE TABLE inventory (
  product_id int PRIMARY KEY REFERENCES products(id),
  warehouse_code varchar(20) NOT NULL,
  quantity int NOT NULL,
  updated_at timestamp NOT NULL
);

CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  order_number varchar(40) NOT NULL UNIQUE,
  status varchar(20) NOT NULL,
  placed_at timestamp NOT NULL,
  total_amount numeric NOT NULL,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  UNIQUE (customer_id, placed_at)
);

CREATE TABLE order_items (
  id int PRIMARY KEY,
  order_id int NOT NULL,
  product_id int NOT NULL,
  quantity int NOT NULL,
  unit_price numeric NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id),
  UNIQUE (order_id, product_id)
);

CREATE TABLE payments (
  id int PRIMARY KEY,
  order_id int NOT NULL UNIQUE,
  payment_method varchar(30) NOT NULL,
  status varchar(20) NOT NULL,
  paid_at timestamp,
  amount numeric NOT NULL,
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE shipments (
  id int PRIMARY KEY,
  order_id int NOT NULL UNIQUE,
  carrier varchar(80) NOT NULL,
  tracking_number varchar(120) UNIQUE,
  shipped_at timestamp,
  delivered_at timestamp,
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE returns (
  id int PRIMARY KEY,
  order_item_id int NOT NULL,
  reason varchar(160) NOT NULL,
  status varchar(20) NOT NULL,
  requested_at timestamp NOT NULL,
  CONSTRAINT fk_returns_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);

CREATE INDEX idx_customers_region_status ON customers (region_id, status);
CREATE INDEX idx_customers_status_created ON customers (status, created_at);
CREATE INDEX idx_addresses_city_country ON addresses (city, country_code);
CREATE INDEX idx_products_category_active_price ON products (category, active, price);
CREATE INDEX idx_inventory_warehouse_quantity ON inventory (warehouse_code, quantity);
CREATE INDEX idx_orders_customer_status_placed ON orders (customer_id, status, placed_at);
CREATE INDEX idx_orders_status_placed ON orders (status, placed_at);
CREATE INDEX idx_order_items_product_order ON order_items (product_id, order_id);
CREATE INDEX idx_payments_status_paid ON payments (status, paid_at);
CREATE INDEX idx_shipments_carrier_shipped ON shipments (carrier, shipped_at);
CREATE INDEX idx_returns_status_requested ON returns (status, requested_at);
```

## MySQL DDL

Select **MySQL** in the app before using this block.

```sql
CREATE TABLE regions (
  id INT NOT NULL,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_regions_code (code)
);

CREATE TABLE customers (
  id INT NOT NULL,
  region_id INT NOT NULL,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL,
  last_login_at DATETIME,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_email (email),
  KEY idx_customers_region_status (region_id, status),
  KEY idx_customers_status_created (status, created_at),
  CONSTRAINT fk_customers_region FOREIGN KEY (region_id) REFERENCES regions(id)
);

CREATE TABLE addresses (
  id INT NOT NULL,
  customer_id INT NOT NULL,
  address_type VARCHAR(20) NOT NULL,
  city VARCHAR(120) NOT NULL,
  country_code VARCHAR(2) NOT NULL,
  postal_code VARCHAR(20),
  PRIMARY KEY (id),
  UNIQUE KEY uq_addresses_customer_type (customer_id, address_type),
  KEY idx_addresses_city_country (city, country_code),
  CONSTRAINT fk_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE products (
  id INT NOT NULL,
  sku VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(80) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  active INT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  KEY idx_products_category_active_price (category, active, price)
);

CREATE TABLE inventory (
  product_id INT NOT NULL,
  warehouse_code VARCHAR(20) NOT NULL,
  quantity INT NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (product_id),
  KEY idx_inventory_warehouse_quantity (warehouse_code, quantity),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE orders (
  id INT NOT NULL,
  customer_id INT NOT NULL,
  order_number VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL,
  placed_at DATETIME NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  UNIQUE KEY uq_orders_customer_placed (customer_id, placed_at),
  KEY idx_orders_customer_status_placed (customer_id, status, placed_at),
  KEY idx_orders_status_placed (status, placed_at),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
  id INT NOT NULL,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_items_order_product (order_id, product_id),
  KEY idx_order_items_product_order (product_id, order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE payments (
  id INT NOT NULL,
  order_id INT NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL,
  paid_at DATETIME,
  amount DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (order_id),
  KEY idx_payments_status_paid (status, paid_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE shipments (
  id INT NOT NULL,
  order_id INT NOT NULL,
  carrier VARCHAR(80) NOT NULL,
  tracking_number VARCHAR(120),
  shipped_at DATETIME,
  delivered_at DATETIME,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipments_order (order_id),
  UNIQUE KEY uq_shipments_tracking (tracking_number),
  KEY idx_shipments_carrier_shipped (carrier, shipped_at),
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE returns (
  id INT NOT NULL,
  order_item_id INT NOT NULL,
  reason VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL,
  requested_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_returns_status_requested (status, requested_at),
  CONSTRAINT fk_returns_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id)
);
```

## Query Test List

Paste each query separately. Expected focus tells what should be visible in graph/access-path explanation.

### 1. Primary Key And Unique Lookup

Expected focus: `pk_lookup`, `unique_lookup`, single-table filter nodes, and synthesized indexes from primary/unique keys.

```sql
SELECT * FROM customers WHERE id = 42;
```

```sql
SELECT id, email, status FROM customers WHERE email = 'ana@example.com';
```

```sql
SELECT id, order_number, total_amount FROM orders WHERE order_number = 'ORD-2026-0001';
```

```sql
SELECT id, tracking_number FROM shipments WHERE tracking_number = '1Z999AA10123456784';
```

### 2. Composite Index Equality Prefix

Expected focus: composite index seek when filters match leftmost index columns.

```sql
SELECT id, first_name, last_name
FROM customers
WHERE region_id = 3 AND status = 'active';
```

```sql
SELECT id, placed_at, total_amount
FROM orders
WHERE customer_id = 42 AND status = 'paid';
```

```sql
SELECT id, quantity, unit_price
FROM order_items
WHERE order_id = 1001 AND product_id = 501;
```

```sql
SELECT product_id, warehouse_code, quantity
FROM inventory
WHERE warehouse_code = 'JKT-01';
```

### 3. Equality Plus Range

Expected focus: `index_range` when equality prefix is followed by range column.

```sql
SELECT id, placed_at, total_amount
FROM orders
WHERE status = 'paid' AND placed_at >= '2026-01-01'
ORDER BY placed_at;
```

```sql
SELECT id, email, created_at
FROM customers
WHERE status = 'active' AND created_at >= '2026-01-01'
ORDER BY created_at DESC;
```

```sql
SELECT id, sku, price
FROM products
WHERE category = 'keyboard' AND active = true AND price BETWEEN 50 AND 200
ORDER BY price;
```

```sql
SELECT product_id, quantity
FROM inventory
WHERE warehouse_code = 'JKT-01' AND quantity < 10
ORDER BY quantity;
```

### 4. Covering Index Candidate

Expected focus: covering scan/seek when selected columns are inside the same index.

```sql
SELECT status, placed_at
FROM orders
WHERE status = 'paid'
ORDER BY placed_at;
```

```sql
SELECT region_id, status
FROM customers
WHERE region_id = 3 AND status = 'active';
```

```sql
SELECT city, country_code
FROM addresses
WHERE city = 'Jakarta' AND country_code = 'ID';
```

```sql
SELECT payment_method, status, paid_at
FROM payments
WHERE status = 'captured' AND paid_at >= '2026-01-01';
```

### 5. Index Miss Or Partial Match

Expected focus: full scan or weaker index use when filter does not match leftmost index column.

```sql
SELECT id, email
FROM customers
WHERE created_at >= '2026-01-01';
```

```sql
SELECT id, total_amount
FROM orders
WHERE placed_at >= '2026-01-01';
```

```sql
SELECT id, sku, name
FROM products
WHERE price > 100;
```

```sql
SELECT id, reason
FROM returns
WHERE requested_at >= '2026-01-01';
```

### 6. Basic Joins

Expected focus: table nodes, join nodes, foreign-key relationships, and per-table access paths.

```sql
SELECT o.id, o.order_number, c.email
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.id = 1001;
```

```sql
SELECT c.email, r.code AS region_code
FROM customers c
JOIN regions r ON r.id = c.region_id
WHERE r.code = 'ID-JW';
```

```sql
SELECT o.order_number, p.status AS payment_status
FROM orders o
LEFT JOIN payments p ON p.order_id = o.id
WHERE o.customer_id = 42;
```

```sql
SELECT o.order_number, s.carrier, s.shipped_at
FROM orders o
LEFT JOIN shipments s ON s.order_id = o.id
WHERE o.status = 'shipped';
```

### 7. Multi-Join Order Flow

Expected focus: multiple join nodes, aggregation pipeline, sort/limit, and index use across several tables.

```sql
SELECT
  o.order_number,
  c.email,
  p.sku,
  oi.quantity,
  oi.unit_price
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.status = 'paid' AND o.placed_at >= '2026-01-01'
ORDER BY o.placed_at DESC
LIMIT 50;
```

```sql
SELECT
  c.email,
  COUNT(o.id) AS order_count,
  SUM(o.total_amount) AS lifetime_value
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE c.status = 'active'
GROUP BY c.email
HAVING SUM(o.total_amount) > 1000
ORDER BY lifetime_value DESC
LIMIT 25;
```

```sql
SELECT
  p.category,
  COUNT(oi.id) AS units_sold,
  SUM(oi.quantity * oi.unit_price) AS revenue
FROM products p
JOIN order_items oi ON oi.product_id = p.id
JOIN orders o ON o.id = oi.order_id
WHERE o.status = 'paid'
GROUP BY p.category
ORDER BY revenue DESC;
```

### 8. Subqueries

Expected focus: subquery nodes, `IN`, `EXISTS`, and nested table access.

```sql
SELECT id, email
FROM customers
WHERE id IN (
  SELECT customer_id
  FROM orders
  WHERE status = 'paid' AND placed_at >= '2026-01-01'
);
```

```sql
SELECT p.id, p.sku, p.name
FROM products p
WHERE EXISTS (
  SELECT 1
  FROM inventory i
  WHERE i.product_id = p.id AND i.quantity > 0
);
```

```sql
SELECT o.id, o.order_number
FROM orders o
WHERE o.total_amount > (
  SELECT AVG(total_amount)
  FROM orders
  WHERE status = 'paid'
);
```

```sql
SELECT c.id, c.email
FROM customers c
WHERE NOT EXISTS (
  SELECT 1
  FROM orders o
  WHERE o.customer_id = c.id
);
```

### 9. Common Table Expressions

Expected focus: CTE nodes, derived datasets, joins against CTE output, and aggregation.

```sql
WITH recent_orders AS (
  SELECT id, customer_id, total_amount
  FROM orders
  WHERE placed_at >= '2026-01-01'
)
SELECT c.email, SUM(ro.total_amount) AS recent_total
FROM recent_orders ro
JOIN customers c ON c.id = ro.customer_id
GROUP BY c.email
ORDER BY recent_total DESC;
```

```sql
WITH paid_orders AS (
  SELECT id, customer_id
  FROM orders
  WHERE status = 'paid'
), return_counts AS (
  SELECT oi.order_id, COUNT(r.id) AS return_count
  FROM order_items oi
  JOIN returns r ON r.order_item_id = oi.id
  GROUP BY oi.order_id
)
SELECT po.customer_id, COALESCE(rc.return_count, 0) AS return_count
FROM paid_orders po
LEFT JOIN return_counts rc ON rc.order_id = po.id;
```

### 10. Outer And Cross Joins

Expected focus: join type labels and multi-source flow.

```sql
SELECT c.email, a.city
FROM customers c
LEFT JOIN addresses a ON a.customer_id = c.id AND a.address_type = 'shipping'
WHERE c.status = 'active';
```

```sql
SELECT p.sku, i.quantity
FROM products p
RIGHT JOIN inventory i ON i.product_id = p.id
WHERE i.quantity < 5;
```

```sql
SELECT r.code, p.category
FROM regions r
CROSS JOIN products p
WHERE p.active = true;
```

```sql
SELECT c.email, o.order_number
FROM customers c
FULL OUTER JOIN orders o ON o.customer_id = c.id;
```

### 11. Sorting, Pagination, Distinct

Expected focus: `DISTINCT`, `ORDER BY`, `LIMIT`, `OFFSET`, and index-aware ordering.

```sql
SELECT DISTINCT status
FROM orders
ORDER BY status;
```

```sql
SELECT id, order_number, placed_at
FROM orders
WHERE status = 'paid'
ORDER BY placed_at DESC
LIMIT 20 OFFSET 40;
```

```sql
SELECT id, email, created_at
FROM customers
WHERE status = 'active'
ORDER BY created_at DESC
LIMIT 10;
```

```sql
SELECT category, price
FROM products
WHERE category = 'keyboard' AND active = true
ORDER BY price DESC
LIMIT 5;
```

### 12. Expressions And Predicates

Expected focus: predicate rendering, expression labels, and filter placement.

```sql
SELECT id, email,
  CASE WHEN last_login_at IS NULL THEN 'never' ELSE 'seen' END AS login_bucket
FROM customers
WHERE status = 'active';
```

```sql
SELECT id, first_name || ' ' || last_name AS full_name
FROM customers
WHERE email LIKE '%@example.com';
```

```sql
SELECT id, order_number, total_amount
FROM orders
WHERE total_amount BETWEEN 100 AND 500;
```

```sql
SELECT id, email
FROM customers
WHERE last_login_at IS NULL OR status IN ('new', 'inactive');
```

### 13. MySQL-Specific Alternatives

Expected focus: same access paths as PostgreSQL tests, using MySQL-friendly booleans and concatenation.

```sql
SELECT id, sku, price
FROM products
WHERE category = 'keyboard' AND active = 1 AND price BETWEEN 50 AND 200
ORDER BY price;
```

```sql
SELECT r.code, p.category
FROM regions r
CROSS JOIN products p
WHERE p.active = 1;
```

```sql
SELECT id, CONCAT(first_name, ' ', last_name) AS full_name
FROM customers
WHERE email LIKE '%@example.com';
```

```sql
SELECT id, CAST(total_amount AS CHAR) AS total_text
FROM orders
WHERE status = 'paid';
```

## Stress Queries

Use these after simpler queries pass. They combine many app features at once.

```sql
WITH product_revenue AS (
  SELECT
    p.id AS product_id,
    p.category,
    SUM(oi.quantity * oi.unit_price) AS revenue
  FROM products p
  JOIN order_items oi ON oi.product_id = p.id
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status = 'paid' AND o.placed_at >= '2026-01-01'
  GROUP BY p.id, p.category
), ranked_categories AS (
  SELECT category, SUM(revenue) AS category_revenue
  FROM product_revenue
  GROUP BY category
)
SELECT category, category_revenue
FROM ranked_categories
WHERE category_revenue > 10000
ORDER BY category_revenue DESC
LIMIT 10;
```

```sql
SELECT
  c.email,
  r.code AS region_code,
  a.city,
  o.order_number,
  p.status AS payment_status,
  s.carrier,
  s.delivered_at
FROM customers c
JOIN regions r ON r.id = c.region_id
LEFT JOIN addresses a ON a.customer_id = c.id AND a.address_type = 'shipping'
JOIN orders o ON o.customer_id = c.id
LEFT JOIN payments p ON p.order_id = o.id
LEFT JOIN shipments s ON s.order_id = o.id
WHERE c.status = 'active'
  AND o.status IN ('paid', 'shipped')
  AND o.placed_at >= '2026-01-01'
ORDER BY o.placed_at DESC
LIMIT 100;
```

```sql
SELECT
  p.sku,
  p.name,
  i.warehouse_code,
  i.quantity,
  COUNT(r.id) AS return_count
FROM products p
JOIN inventory i ON i.product_id = p.id
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN returns r ON r.order_item_id = oi.id AND r.status = 'open'
WHERE p.category = 'keyboard'
  AND p.active = true
  AND i.quantity < 20
GROUP BY p.sku, p.name, i.warehouse_code, i.quantity
ORDER BY i.quantity ASC, return_count DESC;
```

## Parser Limitation Checks

These are useful for checking app error handling. Some may intentionally fail depending on selected dialect/parser.

```sql
SELECT * FROM customers NATURAL JOIN orders;
```

```sql
SELECT * FROM orders LIMIT ALL;
```

```sql
SELECT COUNT(*) FROM orders HAVING COUNT(*) > 1;
```

```sql
CREATE TABLE broken (
```

## Suggested Test Order

1. Paste DDL and confirm schema summary shows tables and indexes.
2. Run section 1 to confirm primary/unique index recognition.
3. Run sections 2-5 to compare index hit, range hit, covering hit, and index miss.
4. Run sections 6-10 to verify joins, CTEs, subqueries, aggregation, and join type labels.
5. Run stress queries to check large graph layout and readable labels.
6. Run parser limitation checks to verify friendly error handling.
