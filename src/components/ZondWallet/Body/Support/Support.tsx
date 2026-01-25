import React, { useState } from "react";
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
import { SERVER_URL } from "@/config";

type SupportFormValues = {
    name: string;
    email: string;
    subject: string;
    message: string;
};

const Support: React.FC = () => {
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

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
        setSubmitError(null);
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

            setSubmitSuccess(true);
            reset();
        } catch (error: any) {
            setSubmitError(error.message || "Something went wrong. Please try again.");
        }
    };

    return (
        <div className="min-h-screen bg-background">
            <SEO
                title="Support"
                description="Get help with MyQRLWallet"
            />
            <main className="container mx-auto px-4 py-8">
                <h1 className="text-2xl font-semibold mb-6">Support</h1>
                {submitSuccess ? (
                    <div className="rounded-md bg-green-500/15 p-6 text-center">
                        <h2 className="text-lg font-semibold text-green-600 dark:text-green-400 mb-2">
                            Request Submitted
                        </h2>
                        <p className="text-sm text-green-600 dark:text-green-400">
                            Thank you for reaching out. We'll get back to you shortly.
                        </p>
                        <Button
                            variant="outline"
                            className="mt-4"
                            onClick={() => setSubmitSuccess(false)}
                        >
                            Submit Another Request
                        </Button>
                    </div>
                ) : (
                <Form {...form}>
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        {submitError && (
                            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
                                {submitError}
                            </div>
                        )}
                        <FormField
                            control={form.control}
                            name="name"
                            rules={{
                                required: "Name is required.",
                                minLength: {
                                    value: 2,
                                    message: "Name must be at least 2 characters."
                                },
                                maxLength: {
                                    value: 100,
                                    message: "Name must be less than 100 characters."
                                },
                                pattern: {
                                    value: /^[a-zA-Z0-9\s'\-.]+$/,
                                    message: "Only letters, numbers, spaces, hyphens, apostrophes, and periods are allowed."
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
                                maxLength: {
                                    value: 254,
                                    message: "Email must be less than 254 characters."
                                },
                                pattern: {
                                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
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
                                minLength: {
                                    value: 3,
                                    message: "Subject must be at least 3 characters."
                                },
                                maxLength: {
                                    value: 200,
                                    message: "Subject must be less than 200 characters."
                                },
                                pattern: {
                                    value: /^[a-zA-Z0-9\s\-_:()]+$/,
                                    message: "Subject contains invalid characters."
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
                                minLength: {
                                    value: 10,
                                    message: "Message must be at least 10 characters."
                                },
                                maxLength: {
                                    value: 2000,
                                    message: "Message must be less than 2000 characters."
                                },
                                validate: {
                                    noScriptTags: (value) => {
                                        if (/<script|<\/script|javascript:|on\w+=/i.test(value)) {
                                            return "Message contains potentially unsafe content.";
                                        }
                                        return true;
                                    },
                                    noHtmlTags: (value) => {
                                        if (/<[^>]+>/g.test(value)) {
                                            return "HTML tags are not allowed.";
                                        }
                                        return true;
                                    }
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
                )}
            </main>
        </div>
    );
};

export default Support;
