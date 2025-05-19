import React from "react";
import { SEO } from "@/components/SEO/SEO";
import {
    Form,
    FormField,
    FormItem,
    FormLabel,
    FormControl,
    FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Button } from "@/components/UI/Button";
import { useForm, SubmitHandler } from "react-hook-form";
import { toast } from "@/hooks/use-toast";
import { SERVER_URL } from "@/configuration/zondConfig";

type SupportFormValues = {
    name: string;
    email: string;
    subject: string;
    message: string;
};

const Support: React.FC = () => {
    const form = useForm<SupportFormValues>({
        defaultValues: {
            name: "",
            email: "",
            subject: "",
            message: "",
        },
    });

    const {
        handleSubmit,
        reset,
        formState: { isSubmitting },
    } = form;

    const onSubmit: SubmitHandler<SupportFormValues> = async (data) => {
        try {
            // Replace with your actual API endpoint
            const response = await fetch(`${SERVER_URL}/support`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(data),
            });

            if (!response.ok) {
                throw new Error("Failed to submit the support request.");
            }

            toast({
                title: "Request Submitted",
                description: "Thank you for reaching out. We'll get back to you shortly.",
                variant: "default",
            });

            reset();
        } catch (error: any) {
            toast({
                title: "Submission Failed",
                description: error.message || "Something went wrong. Please try again.",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <SEO
                title="Support"
                description="Support for the MyQRLWallet - QRL Web Wallet"
            />
            <main className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-semibold mb-6">Support</h1>
                <Form {...form}>
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            rules={{
                                required: "Name is required.",
                                pattern: {
                                    value: /^[a-zA-Z0-9\s]*$/,
                                    message: "Only letters, numbers, and spaces are allowed."
                                }
                            }}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormLabel>Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Your Name" {...field} />
                                    </FormControl>
                                    <FormMessage>{fieldState.error?.message}</FormMessage>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            rules={{
                                required: "Email is required.",
                                pattern: {
                                    value:
                                        /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                                    message: "Invalid email address.",
                                },
                            }}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormLabel>Email</FormLabel>
                                    <FormControl>
                                        <Input type="email" placeholder="you@example.com" {...field} />
                                    </FormControl>
                                    <FormMessage>{fieldState.error?.message}</FormMessage>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="subject"
                            rules={{
                                required: "Subject is required.",
                                pattern: {
                                    value: /^[a-zA-Z0-9\s]*$/,
                                    message: "Only letters, numbers, and spaces are allowed."
                                }
                            }}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormLabel>Subject</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Subject of your request" {...field} />
                                    </FormControl>
                                    <FormMessage>{fieldState.error?.message}</FormMessage>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="message"
                            rules={{
                                required: "Message is required.",
                                pattern: {
                                    value: /^[a-zA-Z0-9\s.,?!]*$/,
                                    message: "Only alphanumeric characters, spaces, and basic punctuation are allowed."
                                }
                            }}
                            render={({ field, fieldState }) => (
                                <FormItem>
                                    <FormLabel>Message</FormLabel>
                                    <FormControl>
                                        <textarea
                                            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:ring-primary focus:ring-offset-0"
                                            placeholder="Describe your issue or question..."
                                            rows={5}
                                            {...field}
                                        />
                                    </FormControl>
                                    <FormMessage>{fieldState.error?.message}</FormMessage>
                                </FormItem>
                            )}
                        />
                        <div>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Submitting..." : "Submit"}
                            </Button>
                        </div>
                    </form>
                </Form>
            </main>
        </div>
    );
};

export default Support;
