import { ExternalLink } from 'lucide-react';
import achieveitLogo from '@/assets/achieveit-logo.png';

export function Header() {
  return (
    <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a 
            href="https://www.achieveit.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-3 hover:opacity-90 transition-opacity"
          >
            <img 
              src={achieveitLogo} 
              alt="AchieveIt - Let's actually do this." 
              className="h-10 w-auto"
            />
            <div className="hidden sm:block h-6 w-px bg-border mx-2" />
            <span className="hidden sm:block text-sm font-medium text-muted-foreground">
              Plan Import Assistant
            </span>
          </a>
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
          <a
            href="https://my.achieveit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Log In
          </a>
        </div>
      </div>
    </header>
  );
}
