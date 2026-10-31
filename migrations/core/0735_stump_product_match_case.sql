-- A product whose name is also an everyday word ("Rota", "Slate") can ask that its
-- names count only when written as recorded: "Rota" names the product, "a month
-- rota" does not. Drafting, disclosure and listening read it (STUMP-BRAND-001).
ALTER TABLE stump_products ADD COLUMN match_case INTEGER NOT NULL DEFAULT 0 CHECK(match_case IN (0, 1));
