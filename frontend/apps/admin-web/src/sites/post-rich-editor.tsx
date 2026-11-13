"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertLinkIcon from "@mui/icons-material/InsertLink";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { APP_BASE_PATH } from "@/base-path";
import { MediaPickerDialog } from "./media-picker";
import type { MediaPickerResult } from "./media-picker";
import { articleHref, normalizeArticleDocument } from "@uog/ui";

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

export function PostRichEditor({
  value,
  onChange,
  disabled = false,
  onSave,
  siteId,
  canUseMedia = false,
  canUploadMedia = false,
  error = "",
}: {
  siteId?: number;
  canUseMedia?: boolean;
  canUploadMedia?: boolean;
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  onSave: () => void;
  /** Field-level validation message shown under the article body. */
  error?: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const selection = useRef<Range | null>(null);
  const pendingLink = useRef<string | null>(null);
  const linkSelection = useRef<Range | null>(null);
  const [imagePicker, setImagePicker] = useState(false);
  const [image, setImage] = useState<MediaPickerResult | null>(null);
  const [imageAlt, setImageAlt] = useState("");
  const imageRange = useRef<Range | null>(null);
  const pendingImage = useRef<string | null>(null);
  const imageButton = useRef<HTMLButtonElement>(null);
  const [marks, setMarks] = useState({ bold: false, italic: false });
  const [blockStyle, setBlockStyle] = useState("p");
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
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
        aria-label="Article formatting"
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
          <MenuItem value="blockquote" onClick={() => { setBlockStyle("blockquote"); command("formatBlock", "blockquote"); }}>
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
          onClick={() => {
            setBlockStyle("blockquote");
            command("formatBlock", "blockquote");
          }}
        >
          <FormatQuoteIcon fontSize="small" />
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
              color: "text.disabled",
              pointerEvents: "none",
              fontSize: "1.05rem",
              lineHeight: 1.8,
            }}
          >
            Write your article content here…
          </Typography>
        ) : null}
        <Box
          ref={editor}
          role="textbox"
          aria-label="Article body"
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
          }}
        />
      </Box>

      {fieldError ? (
        <Typography role="alert" color="error" sx={{ px: 2, py: 1 }}>
          {fieldError}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 1 }}>
          Ctrl/⌘ B bold · I italic · K link · S save draft
        </Typography>
      )}

      {siteId ? (
        <MediaPickerDialog
          open={imagePicker}
          siteId={siteId}
          canUpload={canUploadMedia}
          returnFocusRef={imageButton}
          onCancel={() => setImagePicker(false)}
          onConfirm={(result) => {
            setImagePicker(false);
            setImage(result);
            setImageAlt(result.altText);
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(image)}
        onClose={() => setImage(null)}
        fullWidth
        maxWidth="sm"
        TransitionProps={{
          onExited: () => {
            const markup = pendingImage.current;
            pendingImage.current = null;
            if (markup) command("insertHTML", markup, imageRange.current);
          },
        }}
        aria-labelledby="article-image-title"
      >
        <DialogTitle id="article-image-title">Insert article image</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Image alternative text"
            value={imageAlt}
            onChange={(event) => setImageAlt(event.target.value)}
            inputProps={{ maxLength: 1000 }}
            helperText="Describe this image for readers who cannot see it."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setImage(null)}>Cancel</Button>
          <Button
            disabled={!imageAlt.trim() || disabled}
            onClick={() => {
              if (!image || !siteId) return;
              const element = document.createElement("img");
              element.dataset.assetId = image.assetId;
              element.dataset.nodeId = crypto.randomUUID();
              element.alt = imageAlt.trim();
              element.src = `${APP_BASE_PATH}/sites/${siteId}/media/${image.assetId}/image?variant=display`;
              pendingImage.current = element.outerHTML;
              setImage(null);
            }}
          >
            Insert image
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
        aria-labelledby="article-link-title"
      >
        <DialogTitle id="article-link-title">Insert article link</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Link destination"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            sx={{ mt: 1 }}
            error={Boolean(href && !articleHref(href.trim()))}
            helperText="Use a Site path, http(s) URL or email link. Select the link text in the article first."
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
