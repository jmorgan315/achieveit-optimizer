import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlanItem, PlanLevel } from '@/types/plan';
import {
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Calendar,
  User,
  Sparkles,
  GripVertical,
  Settings2,
} from 'lucide-react';

interface PlanOptimizerStepProps {
  items: PlanItem[];
  levels: PlanLevel[];
  onUpdateItem: (id: string, updates: Partial<PlanItem>) => void;
  onMoveItem: (itemId: string, newParentId: string | null) => void;
  onExport: () => void;
}

export function PlanOptimizerStep({
  items,
  levels,
  onUpdateItem,
  onExport,
}: PlanOptimizerStepProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(items.map((i) => i.id)));
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null);
  const [showMetricDialog, setShowMetricDialog] = useState(false);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedItems);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedItems(next);
  };

  const getIssueColor = (type: string) => {
    switch (type) {
      case 'missing-owner':
        return 'bg-destructive/10 border-destructive/30 text-destructive';
      case 'missing-dates':
        return 'bg-warning/10 border-warning/30 text-warning';
      case 'orphan':
        return 'bg-info/10 border-info/30 text-info';
      default:
        return 'bg-muted';
    }
  };

  const rootItems = items.filter((i) => !i.parentId);

  const getChildren = (parentId: string) => items.filter((i) => i.parentId === parentId);

  const renderItem = (item: PlanItem, depth: number = 0) => {
    const children = getChildren(item.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const hasIssues = item.issues.length > 0;

    return (
      <div key={item.id}>
        <div
          className={`flex items-center gap-2 py-3 px-4 border-b hover:bg-muted/50 transition-colors ${
            hasIssues ? 'bg-destructive/5' : ''
          }`}
          style={{ paddingLeft: `${depth * 24 + 16}px` }}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab opacity-50" />

          {hasChildren ? (
            <button
              onClick={() => toggleExpand(item.id)}
              className="p-1 hover:bg-muted rounded"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="w-6" />
          )}

          <Badge variant="outline" className="text-xs font-normal">
            {item.order}
          </Badge>

          <Badge variant="secondary" className="text-xs">
            {item.levelName}
          </Badge>

          <span className="font-medium flex-1 truncate">{item.name}</span>

          {item.issues.map((issue, i) => (
            <Badge
              key={i}
              variant="outline"
              className={`text-xs ${getIssueColor(issue.type)}`}
            >
              {issue.type === 'missing-owner' && <User className="h-3 w-3 mr-1" />}
              {issue.type === 'missing-dates' && <Calendar className="h-3 w-3 mr-1" />}
              {issue.type === 'orphan' && <AlertCircle className="h-3 w-3 mr-1" />}
              {issue.type.replace('missing-', '')}
            </Badge>
          ))}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedItem(item);
              setShowMetricDialog(true);
            }}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Optimize
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedItem(item)}
          >
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>

        {isExpanded && children.map((child) => renderItem(child, depth + 1))}
      </div>
    );
  };

  const issueStats = {
    missingOwner: items.filter((i) => i.issues.some((is) => is.type === 'missing-owner')).length,
    missingDates: items.filter((i) => i.issues.some((is) => is.type === 'missing-dates')).length,
    orphans: items.filter((i) => i.issues.some((is) => is.type === 'orphan')).length,
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-foreground">{items.length}</div>
            <div className="text-sm text-muted-foreground">Total Items</div>
          </CardContent>
        </Card>
        <Card className={issueStats.missingOwner > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.missingOwner > 0 ? 'text-destructive' : 'text-success'}`}>
              {issueStats.missingOwner}
            </div>
            <div className="text-sm text-muted-foreground">Missing Owners</div>
          </CardContent>
        </Card>
        <Card className={issueStats.missingDates > 0 ? 'border-warning/50' : ''}>
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.missingDates > 0 ? 'text-warning' : 'text-success'}`}>
              {issueStats.missingDates}
            </div>
            <div className="text-sm text-muted-foreground">Missing Dates</div>
          </CardContent>
        </Card>
        <Card className={issueStats.orphans > 0 ? 'border-info/50' : ''}>
          <CardContent className="p-4">
            <div className={`text-2xl font-bold ${issueStats.orphans > 0 ? 'text-info' : 'text-success'}`}>
              {issueStats.orphans}
            </div>
            <div className="text-sm text-muted-foreground">Orphan Items</div>
          </CardContent>
        </Card>
      </div>

      {/* Tree View */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-lg">Plan Structure</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {rootItems.map((item) => renderItem(item))}
          </div>
        </CardContent>
      </Card>

      {/* Export Button */}
      <Button onClick={onExport} className="w-full h-12 text-base">
        Download AchieveIt Import File
      </Button>

      {/* Metric Suggestion Dialog */}
      <Dialog open={showMetricDialog} onOpenChange={setShowMetricDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generate Metric Suggestion
            </DialogTitle>
            <DialogDescription>
              AI-powered metric optimization for "{selectedItem?.name}"
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="p-4 rounded-lg bg-muted border">
              <p className="text-sm font-medium mb-2">Current: {selectedItem?.name}</p>
              <p className="text-sm text-primary font-medium">
                Suggested: {selectedItem?.name.includes('Improve')
                  ? selectedItem?.name.replace('Improve', 'Increase') + ' by 15%'
                  : selectedItem?.name + ' - Target: +20%'}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Metric Name</label>
                <Input
                  value={selectedItem?.metricName || ''}
                  onChange={(e) =>
                    selectedItem && onUpdateItem(selectedItem.id, { metricName: e.target.value })
                  }
                  placeholder="e.g., Sales Growth"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Target Value</label>
                <Input
                  value={selectedItem?.metricTarget || ''}
                  onChange={(e) =>
                    selectedItem && onUpdateItem(selectedItem.id, { metricTarget: e.target.value })
                  }
                  placeholder="e.g., 15"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Data Type</label>
                <Select
                  value={selectedItem?.metricDataType || ''}
                  onValueChange={(value) =>
                    selectedItem &&
                    onUpdateItem(selectedItem.id, {
                      metricDataType: value as PlanItem['metricDataType'],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Percentage">Percentage</SelectItem>
                    <SelectItem value="Number">Number</SelectItem>
                    <SelectItem value="Currency">Currency</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMetricDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => setShowMetricDialog(false)}>
              Apply Suggestion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
