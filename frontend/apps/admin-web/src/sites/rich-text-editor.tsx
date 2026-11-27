"use client";

/**
 * Shared Rich Text Editor (WYSIWYG) for Page and Post create/edit forms.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatColorFillIcon from "@mui/icons-material/FormatColorFill";
import FormatColorTextIcon from "@mui/icons-material/FormatColorText";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertLinkIcon from "@mui/icons-material/InsertLink";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import TextShadowIcon from "@mui/icons-material/TextFields";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { APP_BASE_PATH } from "@/base-path";
import { LazyMediaPickerDialog as MediaPickerDialog } from "./lazy-media-picker";
import type { MediaPickerResult } from "./media-picker-model";
import { articleHref, imageLayoutStyle, normalizeArticleDocument, type ImageAlign } from "@uog/ui";

const TEXT_COLORS = ["#001a33", "#003366", "#b42318", "#b54708", "#067647", "#175cd3", "#6941c6", "#ffffff", "#111827"];
const HIGHLIGHT_COLORS = ["#fef3c7", "#dcfce7", "#dbeafe", "#fce7f3", "#ffedd5", "#e0e7ff", "#f3f4f6", "transparent"];
const SHADOW_PRESETS = [
  { label: "None", value: "none" },
  { label: "Soft", value: "0 1px 2px rgba(0,0,0,0.35)" },
  { label: "Strong", value: "0 2px 6px rgba(0,0,0,0.45)" },
  { label: "Glow", value: "0 0 8px rgba(201,162,39,0.75)" },
] as const;

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
  buttonRef,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          ref={buttonRef}
          size="small"
          disabled={disabled}
          aria-label={label}
          aria-pressed={pressed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          sx={{
            borderRadius: 1,
            width: 36,
            height: 36,
            color: pressed ? "primary.main" : "text.secondary",
            bgcolor: pressed ? "action.selected" : "transparent",
            "&:hover": { bgcolor: pressed ? "action.selected" : "action.hover" },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/**
 * Shared professional WYSIWYG for Page and Post body content.
 *
 * Stores HTML through the article-document contract (headings, paragraphs,
 * lists, quotes, links, Site media images). Complex Page layouts stay in the
 * Visual Builder — this editor is the simple content path for both forms.
 */
export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  onSave,
  siteId,
  canUseMedia = false,
  canUploadMedia = false,
  error = "",
  label = "Content",
  toolbarLabel = "Formatting",
  placeholder = "Write your content here…",
  imageDialogTitle = "Insert image",
  linkDialogTitle = "Insert link",
}: {
  siteId?: number;
  canUseMedia?: boolean;
  canUploadMedia?: boolean;
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  onSave: () => void;
  /** Field-level validation message shown under the editor. */
  error?: string;
  /** Accessible name of the editable region. */
  label?: string;
  /** Accessible name of the formatting toolbar. */
  toolbarLabel?: string;
  placeholder?: string;
  imageDialogTitle?: string;
  linkDialogTitle?: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const selection = useRef<Range | null>(null);
  const pendingLink = useRef<string | null>(null);
  const linkSelection = useRef<Range | null>(null);
  const [imagePicker, setImagePicker] = useState(false);
  const [images, setImages] = useState<MediaPickerResult[]>([]);
  const [imageAlt, setImageAlt] = useState("");
  const [imageAlign, setImageAlign] = useState<ImageAlign>("center");
  const [imageWidth, setImageWidth] = useState(100);
  const imageRange = useRef<Range | null>(null);
  const pendingImage = useRef<string | null>(null);
  const imageButton = useRef<HTMLButtonElement>(null);
  const [marks, setMarks] = useState({ bold: false, italic: false });
  const [blockStyle, setBlockStyle] = useState("p");
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [tableOpen, setTableOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [problem, setProblem] = useState("");
  const [focused, setFocused] = useState(false);
  const { safe, validationProblem } = useMemo(() => {
    try {
      return {
        safe: normalizeArticleDocument({ schema_version: 1, html: value }).html,
        validationProblem: "",
      };
    } catch (error) {
      return {
        safe: null,
        validationProblem:
          error instanceof Error ? error.message : "The article is invalid.",
      };
    }
  }, [value]);
  const empty = !value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

  useLayoutEffect(() => {
    // Replacing native edits destroys browser selection and undo history.
    if (value === lastEmitted.current) return;
    if (
      safe !== null &&
      editor.current &&
      document.activeElement !== editor.current &&
      editor.current.innerHTML !== safe
    )
      editor.current.innerHTML = safe;
    if (siteId && editor.current) {
      editor.current.querySelectorAll<HTMLImageElement>("img[data-asset-id]").forEach((image) => {
        image.src = `${APP_BASE_PATH}/sites/${siteId}/media/${image.dataset.assetId}/image?variant=display`;
      });
    }
  }, [safe, value, siteId]);

  function emitChange() {
    if (!editor.current) return;
    lastEmitted.current = normalizeArticleDocument({ schema_version: 1, html: editor.current.innerHTML }).html;
    onChange(lastEmitted.current);
  }

  function rememberSelection() {
    const current = window.getSelection();
    if (
      current?.rangeCount &&
      editor.current?.contains(document.activeElement) &&
      editor.current.contains(current.anchorNode)
    )
      selection.current = current.getRangeAt(0).cloneRange();
    setMarks({
      bold: Boolean(document.queryCommandState?.("bold")),
      italic: Boolean(document.queryCommandState?.("italic")),
    });
    const raw = String(document.queryCommandValue?.("formatBlock") ?? "p").toLowerCase();
    const normalized = raw.replace(/[<>]/g, "");
    setBlockStyle(
      ["h2", "h3", "h4", "blockquote"].includes(normalized) ? normalized : "p",
    );
  }

  useEffect(() => {
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, []);

  function command(
    name: string,
    argument?: string,
    savedRange = selection.current,
  ) {
    if (disabled || !editor.current) return;
    editor.current.focus();
    const current = window.getSelection();
    if (
      savedRange &&
      editor.current.contains(savedRange.commonAncestorContainer)
    ) {
      current?.removeAllRanges();
      current?.addRange(savedRange);
    }
    document.execCommand(name, false, argument);
    emitChange();
    rememberSelection();
  }

  /** Wrap only the nearest selected block — never the whole editor. */
  function applyQuotation() {
    if (disabled || !editor.current) return;
    rememberSelection();
    editor.current.focus();
    const current = window.getSelection();
    const range = selection.current;
    if (range && editor.current.contains(range.commonAncestorContainer)) {
      current?.removeAllRanges();
      current?.addRange(range);
    }
    let node: Node | null = current?.anchorNode ?? null;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const block = (node as Element | null)?.closest?.("p, h2, h3, h4, blockquote, li, div");
    if (block && editor.current.contains(block) && block !== editor.current) {
      if (block.tagName.toLowerCase() === "blockquote") {
        const parent = block.parentNode;
        while (block.firstChild) parent?.insertBefore(block.firstChild, block);
        parent?.removeChild(block);
        setBlockStyle("p");
      } else if (block.parentElement?.tagName.toLowerCase() === "blockquote") {
        const quote = block.parentElement;
        const parent = quote.parentNode;
        while (quote.firstChild) parent?.insertBefore(quote.firstChild, quote);
        parent?.removeChild(quote);
        setBlockStyle(block.tagName.toLowerCase() === "p" ? "p" : block.tagName.toLowerCase());
      } else {
        const quote = document.createElement("blockquote");
        block.parentNode?.insertBefore(quote, block);
        quote.appendChild(block);
        setBlockStyle("blockquote");
      }
      emitChange();
      rememberSelection();
      return;
    }
    document.execCommand("formatBlock", false, "blockquote");
    setBlockStyle("blockquote");
    emitChange();
    rememberSelection();
  }

  function openLink() {
    rememberSelection();
    linkSelection.current = selection.current?.cloneRange() ?? null;
    setHref("");
    setLinkOpen(true);
  }

  function addLink() {
    const safeHref = articleHref(href.trim());
    if (!safeHref) return;
    pendingLink.current = safeHref;
    setLinkOpen(false);
  }

  const fieldError = error || problem || validationProblem;

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: fieldError ? "error.main" : focused ? "primary.main" : "divider",
        borderRadius: 2,
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: focused ? "0 0 0 3px rgba(25, 118, 210, 0.12)" : "none",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
      }}
    >
      <Box
        role="toolbar"
        aria-label={toolbarLabel}
        sx={{
          display: "flex",
          gap: 0.25,
          flexWrap: "wrap",
          alignItems: "center",
          px: 1,
          py: 0.75,
          bgcolor: "grey.50",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <TextField
          select
          size="small"
          label="Text style"
          value={blockStyle}
          disabled={disabled}
          onChange={(event) => setBlockStyle(event.target.value)}
          sx={{
            minWidth: 132,
            mr: 0.5,
            "& .MuiInputBase-root": { bgcolor: "background.paper", borderRadius: 1 },
          }}
        >
          <MenuItem value="p" onClick={() => { setBlockStyle("p"); command("formatBlock", "p"); }}>Paragraph</MenuItem>
          <MenuItem value="h2" onClick={() => { setBlockStyle("h2"); command("formatBlock", "h2"); }}>Heading 2</MenuItem>
          <MenuItem value="h3" onClick={() => { setBlockStyle("h3"); command("formatBlock", "h3"); }}>Heading 3</MenuItem>
          <MenuItem value="h4" onClick={() => { setBlockStyle("h4"); command("formatBlock", "h4"); }}>Heading 4</MenuItem>
          <MenuItem value="blockquote" onClick={() => { setBlockStyle("blockquote"); applyQuotation(); }}>
            Quotation
          </MenuItem>
        </TextField>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />

        <ToolButton label="Bold" pressed={marks.bold} disabled={disabled} onClick={() => command("bold")}>
          <FormatBoldIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Italic" pressed={marks.italic} disabled={disabled} onClick={() => command("italic")}>
          <FormatItalicIcon fontSize="small" />
        </ToolButton>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />

        <TextField
          select
          size="small"
          label="Text color"
          disabled={disabled}
          defaultValue=""
          sx={{ minWidth: 118, "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
          SelectProps={{
            displayEmpty: true,
            renderValue: () => (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <FormatColorTextIcon fontSize="small" /> Color
              </Box>
            ),
          }}
        >
          {TEXT_COLORS.map((color) => (
            <MenuItem
              key={color}
              value={color}
              onClick={() => command("foreColor", color)}
            >
              <Box sx={{ width: 18, height: 18, borderRadius: 0.5, bgcolor: color, border: "1px solid", borderColor: "divider", mr: 1 }} />
              {color}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Highlight"
          disabled={disabled}
          defaultValue=""
          sx={{ minWidth: 118, "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
          SelectProps={{
            displayEmpty: true,
            renderValue: () => (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <FormatColorFillIcon fontSize="small" /> Highlight
              </Box>
            ),
          }}
        >
          {HIGHLIGHT_COLORS.map((color) => (
            <MenuItem
              key={color}
              value={color}
              onClick={() => {
                if (color === "transparent") command("removeFormat");
                else command("hiliteColor", color);
              }}
            >
              <Box sx={{ width: 18, height: 18, borderRadius: 0.5, bgcolor: color === "transparent" ? "background.paper" : color, border: "1px solid", borderColor: "divider", mr: 1 }} />
              {color === "transparent" ? "Clear" : color}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Shadow"
          disabled={disabled}
          defaultValue=""
          sx={{ minWidth: 110, "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
          SelectProps={{
            displayEmpty: true,
            renderValue: () => (
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
                <TextShadowIcon fontSize="small" /> Shadow
              </Box>
            ),
          }}
        >
          {SHADOW_PRESETS.map((preset) => (
            <MenuItem
              key={preset.label}
              value={preset.value}
              onClick={() => {
                const selected = window.getSelection()?.toString() || "Text";
                command(
                  "insertHTML",
                  `<span style="text-shadow: ${preset.value}">${selected.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</span>`,
                );
              }}
            >
              {preset.label}
            </MenuItem>
          ))}
        </TextField>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />

        <ToolButton label="Bullet list" disabled={disabled} onClick={() => command("insertUnorderedList")}>
          <FormatListBulletedIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Numbered list" disabled={disabled} onClick={() => command("insertOrderedList")}>
          <FormatListNumberedIcon fontSize="small" />
        </ToolButton>
        <ToolButton
          label="Quotation"
          pressed={blockStyle === "blockquote"}
          disabled={disabled}
          onClick={() => applyQuotation()}
        >
          <FormatQuoteIcon fontSize="small" />
        </ToolButton>
        <ToolButton
          label="Insert table"
          disabled={disabled}
          onClick={() => {
            rememberSelection();
            setTableOpen(true);
          }}
        >
          <TableChartOutlinedIcon fontSize="small" />
        </ToolButton>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.75 }} />

        <ToolButton label="Insert link" disabled={disabled} onClick={openLink}>
          <InsertLinkIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Remove link" disabled={disabled} onClick={() => command("unlink")}>
          <LinkOffIcon fontSize="small" />
        </ToolButton>
        {siteId && canUseMedia ? (
          <ToolButton
            label="Insert image"
            disabled={disabled}
            buttonRef={imageButton}
            onClick={() => {
              imageRange.current = selection.current?.cloneRange() ?? null;
              setImageAlign("center");
              setImageWidth(100);
              setImagePicker(true);
            }}
          >
            <ImageOutlinedIcon fontSize="small" />
          </ToolButton>
        ) : null}
      </Box>

      <Box sx={{ position: "relative" }}>
        {empty && !focused ? (
          <Typography
            aria-hidden
            sx={{
              position: "absolute",
              top: 24,
              left: 24,
              right: 24,
              color: "text.secondary",
              pointerEvents: "none",
              fontSize: "1.05rem",
              lineHeight: 1.8,
            }}
          >
            {placeholder}
          </Typography>
        ) : null}
        <Box
          ref={editor}
          role="textbox"
          aria-label={label}
          aria-multiline="true"
          aria-readonly={disabled}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          tabIndex={disabled ? -1 : 0}
          onInput={emitChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            rememberSelection();
          }}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onPaste={(event) => {
            event.preventDefault();
            setProblem("");
            try {
              const html = event.clipboardData.getData("text/html");
              if (html)
                command(
                  "insertHTML",
                  normalizeArticleDocument({ schema_version: 1, html }).html,
                );
              else
                command("insertText", event.clipboardData.getData("text/plain"));
            } catch (error) {
              setProblem(
                error instanceof Error
                  ? error.message
                  : "The pasted content is unsupported.",
              );
            }
          }}
          onDrop={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (["b", "i", "k", "s"].includes(key)) event.preventDefault();
            if (key === "b") command("bold");
            if (key === "i") command("italic");
            if (key === "k") openLink();
            if (key === "s") onSave();
          }}
          sx={{
            p: 3,
            minHeight: 360,
            maxHeight: "62vh",
            overflowY: "auto",
            lineHeight: 1.8,
            fontSize: "1.05rem",
            overflowWrap: "anywhere",
            bgcolor: "background.paper",
            "&:focus-visible": { outline: "none" },
            "& img": { maxWidth: "100%", height: "auto", borderRadius: 1, my: 1.5 },
            "& h2": { fontSize: "1.75rem", fontWeight: 750, mt: 2.5, mb: 1, lineHeight: 1.3 },
            "& h3": { fontSize: "1.4rem", fontWeight: 700, mt: 2.25, mb: 0.75, lineHeight: 1.35 },
            "& h4": { fontSize: "1.15rem", fontWeight: 700, mt: 2, mb: 0.75, lineHeight: 1.4 },
            "& p": { my: 1.1 },
            "& ul, & ol": { pl: 3, my: 1.25 },
            "& li": { my: 0.35 },
            "& blockquote": {
              borderLeft: "4px solid",
              borderColor: "primary.main",
              pl: 2,
              ml: 0,
              my: 2,
              color: "text.secondary",
              fontStyle: "italic",
            },
            "& a": { color: "primary.main", textDecoration: "underline" },
            "& table": { width: "100%", borderCollapse: "collapse", my: 2 },
            "& th, & td": { border: "1px solid", borderColor: "divider", px: 1.25, py: 0.75, textAlign: "left" },
            "& th": { fontWeight: 700, bgcolor: "action.hover" },
            "&::after": { content: '""', display: "table", clear: "both" },
          }}
        />
      </Box>

      {fieldError ? (
        <Typography role="alert" color="error" sx={{ px: 2, py: 1 }}>
          {fieldError}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1, bgcolor: "grey.50", borderTop: "1px solid", borderColor: "divider" }}>
          Ctrl/⌘ B bold · I italic · K link · S save
        </Typography>
      )}

      {siteId ? (
        <MediaPickerDialog
          open={imagePicker}
          siteId={siteId}
          canUpload={canUploadMedia}
          multiple
          title="Choose images"
          returnFocusRef={imageButton}
          onCancel={() => setImagePicker(false)}
          onConfirm={(result) => {
            setImagePicker(false);
            setImages([result]);
            setImageAlt(result.altText);
          }}
          onConfirmMany={(results) => {
            setImagePicker(false);
            setImages(results);
            setImageAlt(results.map((row) => row.altText).filter(Boolean).join("; ") || results[0]?.altText || "");
          }}
        />
      ) : null}
      <Dialog
        open={images.length > 0}
        onClose={() => setImages([])}
        fullWidth
        maxWidth="sm"
        TransitionProps={{
          onExited: () => {
            const markup = pendingImage.current;
            pendingImage.current = null;
            if (markup) command("insertHTML", markup, imageRange.current);
          },
        }}
        aria-labelledby="rich-text-image-title"
      >
        <DialogTitle id="rich-text-image-title">{imageDialogTitle}</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {images.length === 1
              ? "Set alignment and width for this image."
              : `${images.length} images selected. The same alignment and width are applied to each.`}
          </Typography>
          {images.length === 1 ? (
            <TextField
              autoFocus
              fullWidth
              label="Image alternative text"
              value={imageAlt}
              onChange={(event) => setImageAlt(event.target.value)}
              inputProps={{ maxLength: 1000 }}
              helperText="Describe this image for readers who cannot see it."
            />
          ) : null}
          <TextField
            select
            fullWidth
            label="Alignment"
            value={imageAlign}
            onChange={(event) => setImageAlign(event.target.value as ImageAlign)}
          >
            <MenuItem value="left">Left</MenuItem>
            <MenuItem value="center">Center</MenuItem>
            <MenuItem value="right">Right</MenuItem>
            <MenuItem value="full">Full width</MenuItem>
          </TextField>
          <Box>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Width ({imageAlign === "full" ? 100 : imageWidth}%)
            </Typography>
            <Slider
              value={imageAlign === "full" ? 100 : imageWidth}
              min={20}
              max={100}
              step={5}
              disabled={imageAlign === "full"}
              onChange={(_, value) => setImageWidth(Array.isArray(value) ? value[0]! : value)}
              valueLabelDisplay="auto"
              aria-label="Image width"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImages([])}>Cancel</Button>
          <Button
            disabled={disabled || (images.length === 1 && !imageAlt.trim())}
            onClick={() => {
              if (!siteId || images.length === 0) return;
              const style = imageLayoutStyle(imageAlign, imageAlign === "full" ? 100 : imageWidth);
              const markup = images.map((image, index) => {
                const element = document.createElement("img");
                element.dataset.assetId = image.assetId;
                element.dataset.nodeId = crypto.randomUUID();
                element.alt = (images.length === 1 ? imageAlt.trim() : image.altText.trim()) || `Image ${index + 1}`;
                element.src = `${APP_BASE_PATH}/sites/${siteId}/media/${image.assetId}/image?variant=display`;
                element.setAttribute("style", style);
                return element.outerHTML;
              }).join("");
              pendingImage.current = `${markup}<p></p>`;
              setImages([]);
            }}
          >
            {images.length > 1 ? `Insert ${images.length} images` : "Insert image"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={tableOpen} onClose={() => setTableOpen(false)} fullWidth maxWidth="xs" aria-labelledby="rich-text-table-title">
        <DialogTitle id="rich-text-table-title">Insert table</DialogTitle>
        <DialogContent sx={{ display: "grid", gap: 2, pt: 1 }}>
          <TextField
            type="number"
            label="Rows"
            value={tableRows}
            onChange={(event) => setTableRows(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}
            inputProps={{ min: 1, max: 12 }}
          />
          <TextField
            type="number"
            label="Columns"
            value={tableCols}
            onChange={(event) => setTableCols(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
            inputProps={{ min: 1, max: 8 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTableOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              const header = Array.from({ length: tableCols }, (_, index) => `<th>Header ${index + 1}</th>`).join("");
              const body = Array.from({ length: Math.max(0, tableRows - 1) }, () =>
                `<tr>${Array.from({ length: tableCols }, () => "<td>Cell</td>").join("")}</tr>`,
              ).join("");
              const markup = `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table><p></p>`;
              setTableOpen(false);
              command("insertHTML", markup);
            }}
          >
            Insert table
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={linkOpen}
        TransitionProps={{
          onExited: () => {
            const destination = pendingLink.current;
            pendingLink.current = null;
            if (destination)
              command("createLink", destination, linkSelection.current);
          },
        }}
        onClose={() => setLinkOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="rich-text-link-title"
      >
        <DialogTitle id="rich-text-link-title">{linkDialogTitle}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Link destination"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            sx={{ mt: 1 }}
            error={Boolean(href && !articleHref(href.trim()))}
            helperText="Use a Site path, http(s) URL or email link. Select the link text in the editor first."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>Cancel</Button>
          <Button disabled={!articleHref(href.trim())} onClick={addLink}>
            Insert link
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
