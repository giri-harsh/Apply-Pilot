import { useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Fully controlled form. Each input's value comes from React state, and the state is mirrored into
 * <output> elements so a test can prove React (not just the DOM) saw the change.
 */
function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [touchedEmail, setTouchedEmail] = useState(false);
  const emailError = touchedEmail && email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Enter a valid email" : "";

  return (
    <form id="app" noValidate onSubmit={(e) => e.preventDefault()}>
      <h2>Contact</h2>
      <label htmlFor="rname">Full Name</label>
      <input id="rname" name="rname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="remail">Email</label>
      <input
        id="remail"
        name="remail"
        type="email"
        aria-invalid={emailError ? "true" : undefined}
        aria-describedby="remail-err"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouchedEmail(true)}
      />
      <span id="remail-err" role="alert" className="error">{emailError}</span>
      <label htmlFor="rphone">Phone</label>
      <input id="rphone" name="rphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="rcountry">Country</label>
      <select id="rcountry" name="rcountry" value={country} onChange={(e) => setCountry(e.target.value)}>
        <option value="">Select...</option>
        <option value="IN">India</option>
        <option value="US">United States</option>
      </select>
      <button id="submit" type="submit">Submit Application</button>
      <output data-testid="state-name">{name}</output>
      <output data-testid="state-email">{email}</output>
      <output data-testid="state-phone">{phone}</output>
      <output data-testid="state-country">{country}</output>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
