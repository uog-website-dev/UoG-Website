"""Registry-independent block envelope rules for cms.0003.

``blocks`` lives on the shared SiteContent row and is a JSON list, so the
database cannot type its elements with column constraints. One trigger
validates the envelope for every writer — ORM, raw SQL or a future import
tool — repeating the domain's structural floor. Payload-level grammar
(each block's fields) stays in apps/cms/blocks.py; a SQL rewrite of every
block type would be a second schema drift.

Backstopped here (mirrors cms_validate_page's style):

  - blocks is a jsonb array (jsonb_typeof),
  - every element is a JSON object with a supported ``type``,
  - per-element and total serialized sizes are within the documented
    ceilings (MAX_BLOCK_BYTES / MAX_BLOCKS_BYTES).
"""

FORWARD = r"""
CREATE FUNCTION cms_validate_blocks() RETURNS trigger LANGUAGE plpgsql
    VOLATILE AS $$
BEGIN
    IF jsonb_typeof(NEW.blocks) <> 'array' THEN
        RAISE EXCEPTION 'blocks must be a JSON array.'
            USING ERRCODE = '23514', CONSTRAINT = 'content_blocks_array';
    END IF;

    IF NEW.blocks <> '[]'::jsonb THEN
        IF jsonb_array_length(NEW.blocks) > 100 THEN
            RAISE EXCEPTION 'The block list exceeds its item ceiling.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_blocks_count';
        END IF;

        IF octet_length(NEW.blocks::text) > 262144 THEN
            RAISE EXCEPTION 'The block list exceeds its serialized size ceiling.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_blocks_total_size';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(NEW.blocks) AS b(elem)
            WHERE jsonb_typeof(b.elem) <> 'object'
               OR NOT b.elem ? 'type'
               OR b.elem->>'type' NOT IN
                  ('button', 'heading', 'image', 'list', 'paragraph', 'section')
        ) THEN
            RAISE EXCEPTION 'Every block must be an object of a supported type.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_blocks_element_type';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(NEW.blocks) AS b(elem)
            WHERE octet_length(b.elem::text) > 12288
        ) THEN
            RAISE EXCEPTION 'A block exceeds its serialized size ceiling.'
                USING ERRCODE = '23514', CONSTRAINT = 'content_blocks_item_size';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER content_blocks_rules
BEFORE INSERT OR UPDATE ON cms_sitecontent
FOR EACH ROW EXECUTE FUNCTION cms_validate_blocks();
"""

REVERSE = r"""
DROP TRIGGER content_blocks_rules ON cms_sitecontent;
DROP FUNCTION cms_validate_blocks();
"""
