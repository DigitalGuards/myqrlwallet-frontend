import { useTranslation } from "react-i18next";
import { logger } from "@/utils/log";
import { Button } from "../../../../UI/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../UI/Card";
import { useStore } from "../../../../../stores/store";
import { RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";

const ConnectionFailed = observer(() => {
  const { t } = useTranslation(["home", "common"]);
  const { qrlStore } = useStore();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("home:connectionFailed")}</CardTitle>
      </CardHeader>
      <CardContent>{t("home:connectionHint")}</CardContent>
      <CardFooter>
        <Button
          className="w-full"
          type="button"
          onClick={() => {
            qrlStore.fetchQrlConnection().catch((error: unknown) => {
              logger.error("Failed to retry blockchain connection:", error);
            });
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("home:retry")}
        </Button>
      </CardFooter>
    </Card>
  );
});

export default ConnectionFailed;
