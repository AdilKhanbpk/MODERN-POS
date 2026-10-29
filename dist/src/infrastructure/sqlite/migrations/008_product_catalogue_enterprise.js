"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrationV8 = applyMigrationV8;
function applyMigrationV8(db) {
    // Safe restructuring with foreign keys toggled off during table swap
    db.pragma('legacy_alter_table = ON');
    db.pragma('foreign_keys = OFF');
    const defaultBusinessId = '00000000-0000-0000-0000-000000000001';
    const defaultUserId = '00000000-0000-0000-0000-000000000010';
    const tx = db.transaction(() => {
        // -----------------------------------------------------------------------
        // 1. PRODUCT_CATEGORIES TABLE (UUID PK, Multi-Tenant, Nested)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_categories (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        parent_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50),
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_prod_cat_biz ON new_product_categories(business_id);
      CREATE INDEX IF NOT EXISTS idx_prod_cat_parent ON new_product_categories(parent_id);
    `);
        const hasOldCategories = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_categories'").get();
        if (hasOldCategories) {
            // Check if existing product_categories has business_id
            const cols = db.prepare("PRAGMA table_info(product_categories)").all();
            const hasBiz = cols.some(c => c.name === 'business_id');
            if (!hasBiz) {
                db.prepare(`
          INSERT OR IGNORE INTO new_product_categories (id, business_id, parent_id, name, code, is_active, created_at, updated_at)
          SELECT CAST(id AS TEXT), ?, NULL, name, NULL, 1, created_at, created_at
          FROM product_categories
        `).run(defaultBusinessId);
                db.exec('DROP TABLE product_categories;');
                db.exec('ALTER TABLE new_product_categories RENAME TO product_categories;');
            }
            else {
                db.exec('DROP TABLE new_product_categories;');
            }
        }
        else {
            db.exec('ALTER TABLE new_product_categories RENAME TO product_categories;');
        }
        // -----------------------------------------------------------------------
        // 2. BRANDS TABLE (UUID PK, Multi-Tenant)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_brands (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        name VARCHAR(150) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        UNIQUE (business_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_brands_biz ON new_brands(business_id);
    `);
        const hasOldBrands = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='brands'").get();
        if (hasOldBrands) {
            const cols = db.prepare("PRAGMA table_info(brands)").all();
            const hasBiz = cols.some(c => c.name === 'business_id');
            if (!hasBiz) {
                db.prepare(`
          INSERT OR IGNORE INTO new_brands (id, business_id, name, is_active, created_at, updated_at)
          SELECT CAST(id AS TEXT), ?, name, is_active, (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')), (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
          FROM brands
        `).run(defaultBusinessId);
                db.exec('DROP TABLE brands;');
                db.exec('ALTER TABLE new_brands RENAME TO brands;');
            }
            else {
                db.exec('DROP TABLE new_brands;');
            }
        }
        else {
            db.exec('ALTER TABLE new_brands RENAME TO brands;');
        }
        // -----------------------------------------------------------------------
        // 3. PRODUCTS TABLE (UUID PK, Multi-Tenant, Universal Schema)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_products (
        id UUID PRIMARY KEY DEFAULT (LOWER(HEX(RANDOMBLOB(4))) || '-' || LOWER(HEX(RANDOMBLOB(2))) || '-4' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-a' || SUBSTR(LOWER(HEX(RANDOMBLOB(2))),2) || '-' || LOWER(HEX(RANDOMBLOB(6)))),
        business_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES businesses(id) ON DELETE RESTRICT,
        sku VARCHAR(80) NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        category_id UUID REFERENCES product_categories(id) ON DELETE RESTRICT,
        brand_id UUID REFERENCES brands(id) ON DELETE RESTRICT,
        product_type VARCHAR(30) NOT NULL DEFAULT 'standard' CHECK(product_type IN ('standard', 'variant_parent', 'variant', 'service', 'weighted')),
        base_unit_id UUID NOT NULL DEFAULT 1 REFERENCES units(id) ON DELETE RESTRICT,
        default_sale_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
        default_purchase_unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
        cost_method VARCHAR(30) NOT NULL DEFAULT 'weighted_average' CHECK(cost_method IN ('weighted_average', 'fifo')),
        track_stock BOOLEAN NOT NULL DEFAULT 1 CHECK(track_stock IN (0, 1)),
        allow_negative_stock BOOLEAN NOT NULL DEFAULT 0 CHECK(allow_negative_stock IN (0, 1)),
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        image_path TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,

        -- Cached compatibility fields for fast cart lookups
        barcode VARCHAR(100),
        base_unit TEXT DEFAULT 'Piece',
        cost_price BIGINT NOT NULL DEFAULT 0,
        selling_price BIGINT NOT NULL DEFAULT 0,
        default_cost_minor BIGINT NOT NULL DEFAULT 0,
        default_sale_price_minor BIGINT NOT NULL DEFAULT 0,
        current_stock REAL NOT NULL DEFAULT 0,
        min_stock_level REAL NOT NULL DEFAULT 5,
        reorder_level_scaled REAL NOT NULL DEFAULT 5,
        tracking_mode TEXT NOT NULL DEFAULT 'STANDARD',
        tax_rate REAL NOT NULL DEFAULT 0,
        is_tax_inclusive BOOLEAN NOT NULL DEFAULT 0,

        UNIQUE (business_id, sku)
      );
      CREATE INDEX IF NOT EXISTS idx_products_biz ON new_products(business_id);
      CREATE INDEX IF NOT EXISTS idx_products_biz_sku ON new_products(business_id, sku);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON new_products(barcode);
      CREATE INDEX IF NOT EXISTS idx_products_category ON new_products(category_id);
      CREATE INDEX IF NOT EXISTS idx_products_brand ON new_products(brand_id);
      CREATE INDEX IF NOT EXISTS idx_products_active ON new_products(is_active);
    `);
        const hasOldProducts = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='products'").get();
        if (hasOldProducts) {
            const cols = db.prepare("PRAGMA table_info(products)").all();
            const hasBiz = cols.some(c => c.name === 'business_id');
            if (!hasBiz) {
                db.prepare(`
          INSERT OR IGNORE INTO new_products (
            id, business_id, sku, name, description, category_id, brand_id, product_type,
            base_unit_id, default_sale_unit_id, default_purchase_unit_id, cost_method,
            track_stock, allow_negative_stock, is_active, image_path, created_at, updated_at,
            created_by, barcode, base_unit, cost_price, selling_price, current_stock, min_stock_level,
            tax_rate, is_tax_inclusive
          )
          SELECT
            p.id,
            ?,
            p.sku,
            p.name,
            NULL,
            p.category_id,
            p.brand_id,
            'standard',
            COALESCE(p.base_unit_id, 1),
            COALESCE(p.base_unit_id, 1),
            COALESCE(p.base_unit_id, 1),
            'weighted_average',
            1,
            0,
            p.is_active,
            NULL,
            p.created_at,
            p.created_at,
            ?,
            p.barcode,
            COALESCE(p.base_unit, 'Piece'),
            COALESCE(p.cost_price, 0),
            COALESCE(p.selling_price, 0),
            COALESCE(p.current_stock, 0),
            COALESCE(p.min_stock_level, 5),
            COALESCE(p.tax_rate, 0),
            COALESCE(p.is_tax_inclusive, 0)
          FROM products p
        `).run(defaultBusinessId, defaultUserId);
                db.exec('DROP TABLE products;');
                db.exec('ALTER TABLE new_products RENAME TO products;');
            }
            else {
                db.exec('DROP TABLE new_products;');
            }
        }
        else {
            db.exec('ALTER TABLE new_products RENAME TO products;');
        }
        // -----------------------------------------------------------------------
        // 4. PRODUCT_DETAILS TABLE (Optional General Attributes)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS product_details (
        product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        manufacturer VARCHAR(150),
        model_number VARCHAR(100),
        country_of_origin VARCHAR(100),
        warranty_months INTEGER CHECK(warranty_months >= 0),
        custom_attributes TEXT -- JSON
      );
      CREATE INDEX IF NOT EXISTS idx_prod_details_model ON product_details(model_number);
    `);
        // -----------------------------------------------------------------------
        // 5. PRODUCT_PRICES TABLE (UUID PK, Multi-Tenant, Non-Overlapping Rules)
        // -----------------------------------------------------------------------
        db.exec(`
      CREATE TABLE IF NOT EXISTS new_product_prices (
        id UUID PRIMARY KEY,
        business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
        product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price_type VARCHAR(30) NOT NULL CHECK(price_type IN ('retail', 'wholesale', 'special', 'minimum')),
        unit_id UUID NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        amount_minor BIGINT NOT NULL CHECK(amount_minor >= 0),
        currency_code CHAR(3) NOT NULL DEFAULT 'PKR',
        minimum_quantity_scaled BIGINT NOT NULL DEFAULT 0,
        valid_from TIMESTAMP,
        valid_to TIMESTAMP,
        is_active BOOLEAN NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
        created_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')),
        updated_at TIMESTAMP NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW'))
      );
      CREATE INDEX IF NOT EXISTS idx_prod_prices_lookup ON new_product_prices(business_id, product_id, unit_id, price_type, is_active);
    `);
        const hasOldPrices = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_prices'").get();
        if (hasOldPrices) {
            const cols = db.prepare("PRAGMA table_info(product_prices)").all();
            const hasBiz = cols.some(c => c.name === 'business_id');
            if (!hasBiz) {
                db.exec('DROP TABLE product_prices;');
                db.exec('ALTER TABLE new_product_prices RENAME TO product_prices;');
            }
            else {
                db.exec('DROP TABLE new_product_prices;');
            }
        }
        else {
            db.exec('ALTER TABLE new_product_prices RENAME TO product_prices;');
        }
        // -----------------------------------------------------------------------
        // 6. RECORD MIGRATION 8
        // -----------------------------------------------------------------------
        db.prepare('INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)').run(8, '008_product_catalogue_enterprise');
    });
    tx();
    db.pragma('foreign_keys = ON');
}
