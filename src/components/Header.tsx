import { ExternalLink, Settings, LogOut, UserCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import achieveitLogo from '@/assets/achieveit-logo.png';
import type { User } from '@supabase/supabase-js';

interface HeaderProps {
  onHomeClick?: () => void;
  user?: User | null;
  isAdmin?: boolean;
  displayName?: string | null;
  onSignOut?: () => void;
}

export function Header({ onHomeClick, user, isAdmin, displayName, onSignOut }: HeaderProps) {
  return (
    <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onHomeClick ? (
            <button
              onClick={onHomeClick}
              className="hover:opacity-90 transition-opacity cursor-pointer"
            >
              <img 
                src={achieveitLogo} 
                alt="AchieveIt - Let's actually do this." 
                className="h-10 w-auto"
              />
            </button>
          ) : (
            <Link 
              to="/"
              className="hover:opacity-90 transition-opacity"
            >
              <img 
                src={achieveitLogo} 
                alt="AchieveIt - Let's actually do this." 
                className="h-10 w-auto"
              />
            </Link>
          )}
          <div className="hidden sm:block h-6 w-px bg-border mx-2" />
          <span className="hidden sm:block text-sm font-medium text-muted-foreground">
            Plan Import Assistant
          </span>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://support.achieveit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1.5"
          >
            Support
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {isAdmin && (
            <Link
              to="/admin"
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Admin"
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
          {user && (
            <div className="flex items-center gap-2">
              <Link
                to="/account"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 truncate max-w-[160px]"
                title="Account Settings"
              >
                <UserCircle className="h-4 w-4 shrink-0" />
                {displayName || user.user_metadata?.full_name || user.user_metadata?.name || user.email}
              </Link>
              <button
                onClick={onSignOut}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                title="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
