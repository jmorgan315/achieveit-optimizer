import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { UserPlus, Loader2, MoreHorizontal, Pencil, KeyRound, Trash2 } from 'lucide-react';

interface UserProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  feature_flags: Record<string, boolean>;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite dialog
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  // Edit dialog
  const [editUser, setEditUser] = useState<UserProfile | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editAdmin, setEditAdmin] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [editFlags, setEditFlags] = useState<Record<string, boolean>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation
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
        feature_flags: (typeof (u as any).feature_flags === 'object' && (u as any).feature_flags !== null ? (u as any).feature_flags : {}) as Record<string, boolean>,
      })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  // --- Invite ---
  const handleInvite = async () => {
    if (!inviteEmail.endsWith('@achieveit.com')) {
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

  // --- Admin action helper ---
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

  // --- Reset password ---
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

  // --- Delete user ---
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

  // --- Edit dialog ---
  const openEdit = (u: UserProfile) => {
    setEditUser(u);
    setEditFirst(u.first_name || '');
    setEditLast(u.last_name || '');
    setEditAdmin(u.is_admin);
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
        is_admin: editAdmin,
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
        is_admin: editAdmin,
        is_active: editActive,
        feature_flags: editFlags,
      } : u));
      toast.success('User updated');
      setEditUser(null);
    }
    setEditSaving(false);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">User Management</h1>
        <Button onClick={() => setInviteOpen(true)} size="sm">
          <UserPlus className="h-4 w-4 mr-2" /> Invite User
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(u => (
                <TableRow key={u.id} className={!u.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{u.email ?? '—'}</TableCell>
                  <TableCell>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell>
                    {u.is_active
                      ? <Badge variant="outline" className="text-green-600 border-green-600/30">Active</Badge>
                      : <Badge variant="destructive">Inactive</Badge>}
                  </TableCell>
                  <TableCell>
                    {u.is_admin && <Badge>Admin</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
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
                        <DropdownMenuItem onClick={() => handleResetPassword(u)} disabled={!u.email}>
                          <KeyRound className="h-4 w-4 mr-2" /> Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(u)} className="text-destructive focus:text-destructive">
                          <Trash2 className="h-4 w-4 mr-2" /> Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
            <div className="flex items-center justify-between">
              <Label>Admin</Label>
              <Switch checked={editAdmin} onCheckedChange={setEditAdmin} />
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
