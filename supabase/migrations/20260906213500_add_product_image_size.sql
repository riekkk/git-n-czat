-- Lets a product's card image be scaled independently of the fixed card
-- image container, so photos with different crops/framing can be sized to
-- fit without re-cropping the source file. Percentage of the container;
-- 100 (default) matches the previous fixed full-fill behavior.
alter table products
  add column if not exists image_size integer not null default 100
  check (image_size between 50 and 200);
