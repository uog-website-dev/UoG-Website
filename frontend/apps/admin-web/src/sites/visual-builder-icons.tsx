import Box from "@mui/material/Box";
import ImageOutlined from "@mui/icons-material/ImageOutlined";
import SlideshowOutlined from "@mui/icons-material/SlideshowOutlined";
import GridViewOutlined from "@mui/icons-material/GridViewOutlined";
import WebOutlined from "@mui/icons-material/WebOutlined";
import ViewQuiltOutlined from "@mui/icons-material/ViewQuiltOutlined";
import ViewCarouselOutlined from "@mui/icons-material/ViewCarouselOutlined";
import PlayCircleOutline from "@mui/icons-material/PlayCircleOutline";
import VideocamOutlined from "@mui/icons-material/VideocamOutlined";
import Crop169Outlined from "@mui/icons-material/Crop169Outlined";
import ArticleOutlined from "@mui/icons-material/ArticleOutlined";
import TabOutlined from "@mui/icons-material/TabOutlined";
import MenuOutlined from "@mui/icons-material/MenuOutlined";
import AdsClickOutlined from "@mui/icons-material/AdsClickOutlined";
import SubjectOutlined from "@mui/icons-material/SubjectOutlined";
import NotesOutlined from "@mui/icons-material/NotesOutlined";
import ChatBubbleOutline from "@mui/icons-material/ChatBubbleOutline";
import PersonOutline from "@mui/icons-material/PersonOutline";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutline";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import StarBorderOutlined from "@mui/icons-material/StarBorderOutlined";
import CreditCardOutlined from "@mui/icons-material/CreditCardOutlined";
import LocationOnOutlined from "@mui/icons-material/LocationOnOutlined";
import ShareOutlined from "@mui/icons-material/ShareOutlined";
import DiamondOutlined from "@mui/icons-material/DiamondOutlined";
import MoreHorizOutlined from "@mui/icons-material/MoreHorizOutlined";
import RepeatOutlined from "@mui/icons-material/RepeatOutlined";
import FilterAltOutlined from "@mui/icons-material/FilterAltOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import FormatListBulletedOutlined from "@mui/icons-material/FormatListBulletedOutlined";
import AnchorOutlined from "@mui/icons-material/AnchorOutlined";
import TimerOutlined from "@mui/icons-material/TimerOutlined";
import type { WidgetType } from "@uog/types";

const widgetIcons = {
  hero_image: ImageOutlined,
  image_slider: SlideshowOutlined,
  image_grid: GridViewOutlined,
  layout_slider: WebOutlined,
  simple_masonry: ViewQuiltOutlined,
  anything_carousel: ViewCarouselOutlined,
  lottie_player: PlayCircleOutline,
  video_player: VideocamOutlined,
  image: ImageOutlined,
  button: Crop169Outlined,
  button_grid: GridViewOutlined,
  contact_form: ArticleOutlined,
  tabs: TabOutlined,
  accordion: MenuOutlined,
  call_to_action: AdsClickOutlined,
  headline: SubjectOutlined,
  editor: NotesOutlined,
  blog: ArticleOutlined,
  recent_posts: SubjectOutlined,
  post_carousel: ViewCarouselOutlined,
  testimonials: ChatBubbleOutline,
  author_box: PersonOutline,
  features: CheckCircleOutline,
  taxonomy: FolderOutlined,
  icon: StarBorderOutlined,
  price_table: CreditCardOutlined,
  google_maps: LocationOnOutlined,
  social_media_buttons: ShareOutlined,
  site_logo: DiamondOutlined,
  site_title: SubjectOutlined,
  page_title: ArticleOutlined,
  menu: MenuOutlined,
  breadcrumbs: MoreHorizOutlined,
  loop_grid: RepeatOutlined,
  loop_carousel: ViewCarouselOutlined,
  taxonomy_filter: FilterAltOutlined,
  post_title: SubjectOutlined,
  post_excerpt: NotesOutlined,
  featured_image: ImageOutlined,
  alert: WarningAmberOutlined,
  table_of_contents: FormatListBulletedOutlined,
  menu_anchor: AnchorOutlined,
  countdown: TimerOutlined,
} satisfies Record<WidgetType, typeof ImageOutlined>;

export function WidgetIcon({ type }: { type: WidgetType }) {
  const Icon = widgetIcons[type];
  return (
    <Box aria-hidden="true" sx={{
      display: "grid", placeItems: "center", width: 30, height: 30,
      bgcolor: "#eff6fd", color: "#0868b9", borderRadius: "9px", flexShrink: 0,
    }}>
      <Icon sx={{ fontSize: 18 }} />
    </Box>
  );
}
