ALTER TABLE "Category" ADD COLUMN "parentId" TEXT;

ALTER TABLE "Category"
  ADD CONSTRAINT "Category_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Category"("dbId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Category_brandId_parentId_order_idx"
  ON "Category"("brandId", "parentId", "order");
