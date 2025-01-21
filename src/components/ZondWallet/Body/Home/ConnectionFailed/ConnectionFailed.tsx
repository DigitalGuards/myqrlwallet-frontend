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
  const { zondStore } = useStore();
  const { fetchZondConnection } = zondStore;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection failed</CardTitle>
      </CardHeader>
      <CardContent>
        Could not connect to the blockchain network. Please check your network
        connection and try again.
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          type="button"
          onClick={() => fetchZondConnection()}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </CardFooter>
    </Card>
  );
});

export default ConnectionFailed;
