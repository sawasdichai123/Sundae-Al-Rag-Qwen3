/**
 * Extracts a human-readable error message from an Axios/fetch error.
 *
 * FastAPI returns errors in the shape:
 *   { detail: string }                    — standard HTTPException
 *   { detail: [{ msg: string, ... }] }    — Pydantic validation error
 *
 * Usage:
 *   } catch (err: unknown) {
 *     const msg = getApiError(err, t("org.inviteFailed"));
 *     setError(msg);
 *   }
 */
export function getApiError(err: unknown, fallback: string): string {
    if (err == null) return fallback;

    // Axios error shape: err.response.data.detail
    const axiosErr = err as {
        response?: { data?: { detail?: string | Array<{ msg: string }> } };
        message?: string;
    };

    const detail = axiosErr.response?.data?.detail;

    if (typeof detail === "string" && detail) return detail;

    // Pydantic validation error: array of { msg: "..." }
    if (Array.isArray(detail) && detail.length > 0) {
        return detail.map((d) => d.msg).join(", ");
    }

    // Network / JS error
    if (typeof axiosErr.message === "string" && axiosErr.message) {
        return axiosErr.message;
    }

    return fallback;
}
