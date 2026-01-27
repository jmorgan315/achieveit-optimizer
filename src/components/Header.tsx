import { FileText, Target } from 'lucide-react';

export function Header() {
  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Target className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground">AchieveIt</h1>
            <p className="text-xs text-muted-foreground">Strategy Consultant</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a
            href="https://www.achieveit.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <FileText className="h-4 w-4" />
            Documentation
          </a>
        </div>
      </div>
    </header>
  );
}
