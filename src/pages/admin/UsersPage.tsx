import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth, UserRole } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { UserPlus, Loader2, MoreHorizontal, Pencil, KeyRound, Trash2, Mail, Link2 } from 'lucide-react';

interface UserProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  role: UserRole;
  created_at: string;
  feature_flags: Record<string, boolean>;
  invited_at: string | null;
  first_login_at: string | null;
}

type InviteStatus = 'active' | 'invited' | 'pending';

function getInviteStatus(u: UserProfile): InviteStatus {
  if (u.first_login_at) return 'active';
  if (u.invited_at) return 'invited';
  return 'pending';
}

function StatusBadge({ status }: { status: InviteStatus }) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-600 hover:bg-green-700 text-white">Active</Badge>;
    case 'invited':
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">Invited</Badge>;
    case 'pending':
      return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
  }
}

export default function UsersPage() {
  const { isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('user');
  const [editActive, setEditActive] = useState(true);
  const [editFlags, setEditFlags] = useState<Record<string, boolean>>({});
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) {
      toast.error('Failed to load users');
    } else {
      setUsers((data ?? []).map(u => ({
        ...u,
        role: ((u as any).role as UserRole) || (u.is_admin ? 'admin' : 'user'),
        feature_flags: (typeof (u as any).feature_flags === 'object' && (u as any).feature_flags !== null ? (u as any).feature_flags : {}) as Record<string, boolean>,
        invited_at: (u as any).invited_at ?? null,
        first_login_at: (u as any).first_login_at ?? null,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleInvite = async () => {
    if (!inviteEmail.toLowerCase().endsWith('@achieveit.com')) {
      toast.error('Only @achieveit.com emails can be invited.');
      return;
    }
    setInviting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('invite-user', {
        body: { email: inviteEmail },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      const payload = res.data as { error?: string };
      if (payload?.error) throw new Error(payload.error);
      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteOpen(false);
      setTimeout(fetchUsers, 2000);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const invokeAdminAction = async (action: string, userId: string, email?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await supabase.functions.invoke('admin-user-actions', {
      body: { action, userId, email },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    });
    if (res.error) throw res.error;
    const payload = res.data as { error?: string };
    if (payload?.error) throw new Error(payload.error);
  };

  const handleResetPassword = async (u: UserProfile) => {
    if (!u.email) return;
    setActionLoading(u.id);
    try {
      await invokeAdminAction('reset_password', u.id, u.email);
      toast.success(`Password reset email sent to ${u.email}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send reset email');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResendInvite = async (u: UserProfile) => {
    if (!u.email) return;
    setActionLoading(u.id);
    try {
      await invokeAdminAction('resend_invite', u.id, u.email);
      toast.success(`Invite resent to ${u.email}`);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, invited_at: new Date().toISOString() } : x));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to resend invite');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // Try modern API first (requires focused document + secure context)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy
    }
    // Legacy fallback — works even when document focus is contested
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyInviteLink = async (u: UserProfile) => {
    if (!u.email) return;
    setActionLoading(u.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('admin-user-actions', {
        body: { action: 'generate_invite_link', userId: u.id, email: u.email },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      const payload = res.data as { error?: string; action_link?: string };
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.action_link) throw new Error('No invite link returned');

      const link = payload.action_link;
      // Wait a tick so dropdown menu releases focus before clipboard write
      await new Promise(r => setTimeout(r, 50));
      const copied = await copyToClipboard(link);

      if (copied) {
        toast.success(`Invite link copied for ${u.email}`, {
          description: 'Paste it into Slack, email, or a message.',
        });
      } else {
        // Last resort — show link in a prompt the user can copy manually
        toast.message(`Invite link for ${u.email}`, {
          description: link,
          duration: 30000,
          action: {
            label: 'Copy',
            onClick: () => copyToClipboard(link),
          },
        });
      }
      // Reflect invited status if it was a fresh invite
      setUsers(prev => prev.map(x => x.id === u.id && !x.invited_at ? { ...x, invited_at: new Date().toISOString() } : x));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate invite link');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await invokeAdminAction('delete_user', deleteTarget.id);
      toast.success('User deleted');
      setUsers(prev => prev.filter(u => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete user');
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (u: UserProfile) => {
    setEditUser(u);
    setEditFirst(u.first_name || '');
    setEditLast(u.last_name || '');
    setEditRole(u.role);
    setEditActive(u.is_active);
    setEditFlags({ ...u.feature_flags });
  };

  const handleEditSave = async () => {
    if (!editUser) return;
    setEditSaving(true);
    const { error } = await supabase
      .from('user_profiles')
      .update({
        first_name: editFirst || null,
        last_name: editLast || null,
        role: editRole,
        is_admin: editRole === 'admin' || editRole === 'super_admin',
        is_active: editActive,
        feature_flags: editFlags,
      } as any)
      .eq('id', editUser.id);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
    } else {
      setUsers(prev => prev.map(u => u.id === editUser.id ? {
        ...u,
        first_name: editFirst || null,
        last_name: editLast || null,
        role: editRole,
        is_admin: editRole === 'admin' || editRole === 'super_admin',
        is_active: editActive,
        feature_flags: editFlags,
      } : u));
      toast.success('User updated');
      setEditUser(null);
    }
    setEditSaving(false);
  };

  const inlineUpdate = async (userId: string, field: string, value: any) => {
    const { error } = await supabase.from('user_profiles').update({ [field]: value } as any).eq('id', userId);
    if (error) {
      toast.error(`Failed to update: ${error.message}`);
      return false;
    }
    return true;
  };

  const toggleActive = async (u: UserProfile) => {
    const newVal = !u.is_active;
    if (await inlineUpdate(u.id, 'is_active', newVal)) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: newVal } : x));
    }
  };

  const toggleFlag = async (u: UserProfile, flag: string) => {
    const newFlags = { ...u.feature_flags, [flag]: !u.feature_flags[flag] };
    if (await inlineUpdate(u.id, 'feature_flags', newFlags)) {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, feature_flags: newFlags } : x));
    }
  };

  const roleBadge = (r: UserRole) => {
    if (r === 'super_admin') return <Badge className="bg-purple-600 hover:bg-purple-700">Super Admin</Badge>;
    if (r === 'admin') return <Badge>Admin</Badge>;
    return <Badge variant="outline">User</Badge>;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">User Management</h1>
        {isSuperAdmin && (
          <Button onClick={() => setInviteOpen(true)} size="sm">
            <UserPlus className="h-4 w-4 mr-2" /> Invite User
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Active</TableHead>
                <TableHead className="text-center">Feedback</TableHead>
                <TableHead className="text-center">Re-import</TableHead>
                <TableHead>Joined</TableHead>
                {isSuperAdmin && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => {
                const status = getInviteStatus(u);
                return (
                  <TableRow key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{u.email ?? '—'}</TableCell>
                    <TableCell>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell>{roleBadge(u.role)}</TableCell>
                    <TableCell><StatusBadge status={status} /></TableCell>
                    <TableCell className="text-center">
                      <Switch checked={u.is_active} onCheckedChange={() => toggleActive(u)} disabled={!isSuperAdmin} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={u.feature_flags.showFeedback ?? false} onCheckedChange={() => toggleFlag(u, 'showFeedback')} disabled={!isSuperAdmin} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch checked={u.feature_flags.showReimport ?? false} onCheckedChange={() => toggleFlag(u, 'showReimport')} disabled={!isSuperAdmin} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={actionLoading === u.id}>
                              {actionLoading === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(u)}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            {status === 'invited' && (
                              <DropdownMenuItem onClick={() => handleResendInvite(u)}>
                                <Mail className="h-4 w-4 mr-2" /> Resend Invite
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleCopyInviteLink(u)} disabled={!u.email}>
                              <Link2 className="h-4 w-4 mr-2" /> Copy Invite Link
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleResetPassword(u)} disabled={!u.email}>
                              <KeyRound className="h-4 w-4 mr-2" /> Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeleteTarget(u)} className="text-destructive focus:text-destructive">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 9 : 8} className="text-center text-muted-foreground py-8">
                    No users found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
            <DialogDescription>Send an invitation to an @achieveit.com email address.</DialogDescription>
          </DialogHeader>
          <Input placeholder="colleague@achieveit.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} type="email" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail}>
              {inviting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={open => { if (!open) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update profile details and permissions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm text-muted-foreground">Email (read-only)</Label>
              <Input value={editUser?.email ?? ''} disabled />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={editFirst} onChange={e => setEditFirst(e.target.value)} />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={editLast} onChange={e => setEditLast(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={v => setEditRole(v as UserRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={editActive} onCheckedChange={setEditActive} />
            </div>
            <div className="border-t pt-3 space-y-2">
              <Label className="text-sm font-medium">Feature Flags</Label>
              <div className="flex items-center justify-between">
                <span className="text-sm">Show Feedback</span>
                <Switch checked={editFlags.showFeedback ?? false} onCheckedChange={v => setEditFlags(f => ({ ...f, showFeedback: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Show Re-import</span>
                <Switch checked={editFlags.showReimport ?? false} onCheckedChange={v => setEditFlags(f => ({ ...f, showReimport: v }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteTarget?.email}</strong> and all their authentication data. Session history will be preserved but unlinked. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
