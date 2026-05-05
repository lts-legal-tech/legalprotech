'use client';
import {
  Box,
  Image as ImageIcon,
  LayoutDashboard,
  MessageSquareText,
  PlusSquare,
  Share2,
  Video,
  Wand2,
} from 'lucide-react';

export function AppIcon({ name, className = 'h-5 w-5' }) {
  switch (name) {
    case 'dashboard':
      return <LayoutDashboard className={className} />;
    case 'chatbot':
      return <MessageSquareText className={className} />;
    case 'new-project':
      return <PlusSquare className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
    case 'box':
      return <Box className={className} />;
    case 'video':
      return <Video className={className} />;
    case 'wand':
      return <Wand2 className={className} />;
    case 'share':
      return <Share2 className={className} />;
    default:
      return <Video className={className} />;
  }
}
