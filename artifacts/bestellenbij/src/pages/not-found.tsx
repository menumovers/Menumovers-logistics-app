import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen w-full grid place-items-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-7 text-destructive" />
            <h1 className="text-2xl font-bold">404</h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("errors.notFound")}</p>
          <Button asChild data-testid="link-not-found-home"><Link href="/">{t("common.back")}</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
