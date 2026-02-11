import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { PersonMapping } from '@/types/plan';
import { Users, Check, AlertCircle, Mail, ArrowLeft } from 'lucide-react';

interface PeopleMapperStepProps {
  personMappings: PersonMapping[];
  onUpdateMapping: (id: string, email: string) => void;
  onComplete: () => void;
  onBack?: () => void;
}

export function PeopleMapperStep({
  personMappings,
  onUpdateMapping,
  onComplete,
  onBack,
}: PeopleMapperStepProps) {
  const [localMappings, setLocalMappings] = useState<Record<string, string>>({});

  const resolvedCount = personMappings.filter(
    (pm) => pm.isResolved || (localMappings[pm.id]?.includes('@'))
  ).length;

  const handleEmailChange = (id: string, email: string) => {
    setLocalMappings({ ...localMappings, [id]: email });
    onUpdateMapping(id, email);
  };

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleComplete = () => {
    onComplete();
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle>Resolve Plan Owners</CardTitle>
                <CardDescription>
                  Map names and departments to email addresses for AchieveIt import
                </CardDescription>
              </div>
            </div>
            <Badge variant={resolvedCount === personMappings.length ? 'default' : 'secondary'}>
              {resolvedCount} / {personMappings.length} Resolved
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[50px]">Status</TableHead>
                  <TableHead>Name / Department Found</TableHead>
                  <TableHead>Email Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {personMappings.map((pm) => {
                  const email = localMappings[pm.id] ?? pm.email;
                  const isValid = isValidEmail(email);

                  return (
                    <TableRow key={pm.id}>
                      <TableCell>
                        {isValid ? (
                          <div className="h-6 w-6 rounded-full bg-success/10 flex items-center justify-center">
                            <Check className="h-4 w-4 text-success" />
                          </div>
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-warning/10 flex items-center justify-center">
                            <AlertCircle className="h-4 w-4 text-warning" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{pm.foundName}</span>
                      </TableCell>
                      <TableCell>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            type="email"
                            placeholder="Enter email address"
                            value={email}
                            onChange={(e) => handleEmailChange(pm.id, e.target.value)}
                            className={`pl-9 ${isValid ? 'border-success/50' : ''}`}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-muted/50 border">
            <h4 className="font-medium text-sm mb-2">💡 Pro Tip</h4>
            <p className="text-sm text-muted-foreground">
              For items with multiple owners (like "Mike Chen and Lisa Wang"), enter the primary owner's 
              email here. Additional owners will be added to the "Members" column in the export.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            {onBack && (
              <Button variant="ghost" onClick={onBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            <Button
              onClick={handleComplete}
              className="flex-1 h-12"
            >
              Continue with {resolvedCount} Resolved Owners
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
