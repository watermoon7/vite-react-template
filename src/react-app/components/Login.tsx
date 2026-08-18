/** Sign-in form. A real form POST so browsers offer to save / autofill the password. */
import { useEffect, useState } from "react";
import { AUTH } from "../../../app.config";

export function Login() {
	// Captured once so the message survives re-renders after the URL is cleaned up.
	const [outcome] = useState(() => new URLSearchParams(location.search).get("login"));

	// Drop ?login=... from the URL once we've read it.
	useEffect(() => {
		if (outcome) history.replaceState(null, "", "/");
	}, [outcome]);

	return (
		<div className="screen-center">
			<form className="login" method="post" action="/api/login">
				<h1 className="login-title">Kanban</h1>
				<label className="field">
					<span className="label">Username</span>
					<input name="username" autoComplete="username" required autoFocus spellCheck={false} />
				</label>
				<label className="field">
					<span className="label">Password</span>
					<input name="password" type="password" autoComplete="current-password" required />
				</label>
				{outcome === "failed" && <p className="form-error">Wrong username or password.</p>}
				{outcome === "locked" && (
					<p className="form-error">Too many failed attempts. Try again in {AUTH.loginLockoutMinutes} minutes.</p>
				)}
				<button className="btn btn-primary btn-block" type="submit">
					Sign in
				</button>
			</form>
		</div>
	);
}
