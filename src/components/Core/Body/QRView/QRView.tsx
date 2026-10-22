import { useTranslation } from "react-i18next";
import { getExplorerAddressUrl } from "@/config";
import { observer } from "mobx-react-lite";
import { QRCodeSVG } from "qrcode.react";
import { Label } from "@/components/UI/Label";
import { useStore } from "@/stores/store";
import { PageShell } from "@/components/Core/Layout/PageShell";
import { Card } from "@/components/UI/Card";

const QRView = observer(() => {
  const { t } = useTranslation("accounts");
  const { qrlStore } = useStore();
  const {
    activeAccount: { accountAddress },
    qrlConnection: { blockchain },
  } = qrlStore;

  return (
    <PageShell title={t("qrTitle")} seoTitle={t("qrSeo")}>
      <Card className="flex flex-col items-center gap-2 p-6">
        <QRCodeSVG
          value={getExplorerAddressUrl(accountAddress, blockchain)}
          size={200}
          bgColor="#000000"
          fgColor="#ffffff"
          level="L"
          marginSize={0}
        />
        <Label className="text-xs text-muted-foreground">{t("qrScan")}</Label>
      </Card>
    </PageShell>
  );
});

export default QRView;
