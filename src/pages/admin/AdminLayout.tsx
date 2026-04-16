import { Outlet, Link } from 'react-router-dom';
import { Settings, List, FileText, Users, MessageSquare, Activity, ArrowLeft, Cog } from 'lucide-react';
import { NavLink } from '@/components/NavLink';
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';

const navItems = [
  { title: 'Sessions', url: '/admin/sessions', icon: List },
  { title: 'API Logs', url: '/admin/logs', icon: FileText },
  { title: 'Users', url: '/admin/users', icon: Users },
  { title: 'Feedback', url: '/admin/feedback', icon: MessageSquare },
  { title: 'Activity', url: '/admin/activity', icon: Activity },
  { title: 'Settings', url: '/admin/settings', icon: Cog },
];

function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <Settings className="h-4 w-4 mr-2" />
            {!collapsed && 'Admin'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} className="hover:bg-muted/50" activeClassName="bg-muted text-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function AdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-12 flex items-center border-b border-border/50 bg-card/80 backdrop-blur-sm px-4 gap-3">
            <SidebarTrigger />
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to App
            </Link>
            <span className="text-sm font-medium ml-auto text-muted-foreground">Admin Panel</span>
          </header>
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
