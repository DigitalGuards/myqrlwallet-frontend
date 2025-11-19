import { Button } from "../../../../UI/Button";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "../../../../UI/Card";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage,
} from "../../../../UI/Form";
import { Input } from "../../../../UI/Input";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { isValidZondAddress } from "@/utilities/addressValidation";

const FormSchema = z
    .object({
        tokenAddress: z.string()
            .min(1, { message: "Token address is required" })
            .refine(isValidZondAddress, {
                message: "Invalid token address. Must be 42 characters starting with 'Z' followed by 40 hex characters"
            }),
        toAddress: z.string()
            .min(1, { message: "Recipient address is required" })
            .refine(isValidZondAddress, {
                message: "Invalid recipient address. Must be 42 characters starting with 'Z' followed by 40 hex characters"
            }),
        amount: z.string()
            .min(1, { message: "Amount is required" })
            .refine((val) => {
                const num = Number(val);
                return !isNaN(num) && num > 0;
            }, { message: "Amount must be a positive number" })
            .transform((val) => Number(val))
    });

type TokenSendingFormProps = {
    onTokenSent: (tokenAddress: string, toAddress: string, amount: number) => void;
};

export const TokenSendingForm = observer(
    ({ onTokenSent }: TokenSendingFormProps) => {

        const form = useForm<z.infer<typeof FormSchema>>({
            resolver: zodResolver(FormSchema),
            mode: "onChange",
            reValidateMode: "onSubmit",
            defaultValues: {
                tokenAddress: "",
                toAddress: "",
            },
        });
        const {
            handleSubmit,
            control,
            formState: { isSubmitting, isValid },
        } = form;

        async function onSubmit(formData: z.infer<typeof FormSchema>) {
            try {
                const tokenAddress = formData.tokenAddress;
                const toAddress = formData.toAddress;
                const amount = formData.amount;
                onTokenSent(tokenAddress, toAddress, amount);
            } catch (error) {
                // control.setError("reEnteredPassword", {
                //   message: `${error} There was an error while creating the account`,
                // });
            }
        }

        return (
            <Form {...form}>
                <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
                    <Card>
                        <CardHeader>
                            <CardTitle>Send Token</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-8">
                            <FormField
                                control={control}
                                name="tokenAddress"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                disabled={isSubmitting}
                                                placeholder="Example: Z20b4fb2929cfBe8b002b8A0c572551F755e54aEF"
                                                type="text"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>Token Address</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="toAddress"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSubmitting}
                                                placeholder="Example: Z20b4fb2929cfBe8b002b8A0c572551F755e54aEF"
                                                type="text"
                                            />
                                        </FormControl>
                                        <FormDescription>To Address</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSubmitting}
                                                placeholder="Example: 1000000000"
                                                type="number"
                                            />
                                        </FormControl>
                                        <FormDescription>Amount</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                        <CardFooter>
                            <Button
                                disabled={isValid}
                                className="w-full"
                                type="submit"
                            >
                                {isSubmitting ? (
                                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <></>
                                )}
                                Send Token
                            </Button>
                        </CardFooter>
                    </Card>
                </form>
            </Form>
        );
    }
);
