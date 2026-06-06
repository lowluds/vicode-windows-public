import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArrowUp,
  ArrowLeft,
  BookOpen,
  Bot,
  Brush,
  Camera,
  CheckCircle2,
  ChevronsDownUp,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Ellipsis,
  FileText,
  Figma,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  Image,
  KeyRound,
  LayoutGrid,
  Loader,
  LoaderCircle,
  LoaderPinwheel,
  LogOut,
  MessageSquareText,
  Mic,
  Monitor,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  PlayCircle,
  Plus,
  Save,
  Settings,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Trash,
  Undo2,
  Video,
  X,
  ListChecks,
  Users
} from 'lucide-react';
import type { ReactNode } from 'react';

// Keep the icon library isolated behind this file so future swaps do not cascade through feature code.
interface AppIconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function iconFactory(Component: LucideIcon, size = 16, strokeWidth = 1.9) {
  return function AppIcon({ size: override = size, className, strokeWidth: nextStrokeWidth = strokeWidth }: AppIconProps) {
    return <Component size={override} strokeWidth={nextStrokeWidth} className={className} />;
  };
}

export function LoadingIcon({
  size = 16,
  className,
  strokeWidth = 1.9
}: AppIconProps) {
  return (
    <span className={className ? `app-loading-icon-shell ${className}` : 'app-loading-icon-shell'} aria-hidden="true">
      <LoaderPinwheel size={size} strokeWidth={strokeWidth} className="app-loading-icon app-loading-icon-primary" />
      <Loader size={size} strokeWidth={strokeWidth} className="app-loading-icon app-loading-icon-echo" />
    </span>
  );
}

export function SidebarIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className ? `sidebar-icon ${className}` : 'sidebar-icon'} aria-hidden="true">
      {children}
    </span>
  );
}

export const FolderIcon = iconFactory(Folder);
export const FolderOpenIcon = iconFactory(FolderOpen);
export const RoomsIcon = iconFactory(LayoutGrid);
export const ThreadDotIcon = iconFactory(MessageSquareText);
export const NewThreadIcon = iconFactory(PencilLine);
export const CollapseAllIcon = iconFactory(ChevronsDownUp, 16);
export const AutomationIcon = iconFactory(Bot);
export const SkillsIcon = iconFactory(SquareTerminal);
export const SettingsIcon = iconFactory(Settings);
export const DefaultsIcon = iconFactory(Settings2);
export const PlusFolderIcon = iconFactory(FolderPlus);
export const PlusIcon = iconFactory(Plus, 14);
export const ChevronDownIcon = iconFactory(ChevronDown, 14);
export const ArrowLeftIcon = iconFactory(ArrowLeft, 14);
export const MicIcon = iconFactory(Mic, 14);
export const SendIcon = iconFactory(ArrowUp, 14);
export const CheckIcon = iconFactory(CheckCircle2, 16);
export const FilterIcon = iconFactory(SlidersHorizontal, 14);
export const AccountIcon = iconFactory(CircleUserRound, 14);
export const GlobeIcon = iconFactory(Globe, 14);
export const LogoutIcon = iconFactory(LogOut, 14);
export const ChevronRightIcon = iconFactory(ChevronRight, 14);
export const EditIcon = iconFactory(PencilLine, 16);
export const CopyIcon = iconFactory(Copy, 16);
export const RefreshIcon = iconFactory(LoaderCircle, 16);
export const ArchiveIcon = iconFactory(Archive, 16);
export const TrashIcon = iconFactory(Trash, 16);
export const UndoIcon = iconFactory(Undo2, 16);
export const SaveIcon = iconFactory(Save, 16);
export const CloseIcon = iconFactory(X, 16);
export const TaskIcon = iconFactory(ListChecks, 16);
export const PlayIcon = iconFactory(PlayCircle, 16);
export const MoreIcon = iconFactory(Ellipsis, 16);
export const EyeIcon = iconFactory(Eye, 16);
export const EyeOffIcon = iconFactory(EyeOff, 16);
export const DocumentIcon = iconFactory(FileText, 16);
export const BookIcon = iconFactory(BookOpen, 16);
export const BrushIcon = iconFactory(Brush, 16);
export const CameraIcon = iconFactory(Camera, 16);
export const ClipboardIcon = iconFactory(ClipboardList, 16);
export const CloudIcon = iconFactory(Cloud, 16);
export const CodeIcon = iconFactory(Code2, 16);
export const CpuIcon = iconFactory(Cpu, 16);
export const DownloadIcon = iconFactory(Download, 16);
export const FigmaIcon = iconFactory(Figma, 16);
export const ImageIcon = iconFactory(Image, 16);
export const AccessIcon = iconFactory(KeyRound, 16);
export const MagicPenIcon = iconFactory(Sparkles, 16);
export const MonitorIcon = iconFactory(Monitor, 16);
export const NoteIcon = iconFactory(NotebookText, 16);
export const PanelLeftCloseIcon = iconFactory(PanelLeftClose, 16);
export const PanelLeftOpenIcon = iconFactory(PanelLeftOpen, 16);
export const ShieldIcon = iconFactory(Shield, 16);
export const VideoIcon = iconFactory(Video, 16);
export const UsersIcon = iconFactory(Users, 16);
