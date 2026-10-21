import { useEffect, useRef, useState } from 'react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import Postmark from '../components/Postmark';
import { buttonVariants } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '../components/ui/input-otp';
import { Label } from '../components/ui/label';

function PassphraseDateInput({ formRef }: { formRef: { current: HTMLFormElement | null } }) {
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    const clearPassphrase = () => setPassphrase('');
    document.addEventListener('gate:reset-passphrase', clearPassphrase);
    return () => document.removeEventListener('gate:reset-passphrase', clearPassphrase);
  }, []);

  return (
    <>
      <Label className="gate-field-label" htmlFor="gate-input">月和日</Label>
      <InputOTP
        id="gate-input"
        data-gate-input
        className="gate-input"
        containerClassName="gate-slots gate-otp"
        aria-label="开始的日子，月和日共四位数字"
        aria-describedby="gate-hint gate-error"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        inputMode="numeric"
        maxLength={4}
        pattern={REGEXP_ONLY_DIGITS}
        pasteTransformer={value => value.replace(/\D/g, '')}
        value={passphrase}
        onChange={setPassphrase}
        onComplete={() => formRef.current?.requestSubmit()}
      >
        <div className="gate-otp-fields">
          <div className="gate-otp-field">
            <span className="gate-otp-label" id="gate-month-label">月</span>
            <InputOTPGroup className="gate-otp-group" role="group" aria-labelledby="gate-month-label">
              <InputOTPSlot index={0} className="gate-slot" />
              <InputOTPSlot index={1} className="gate-slot" />
            </InputOTPGroup>
          </div>
          <InputOTPSeparator className="gate-otp-separator" aria-hidden="true" />
          <div className="gate-otp-field">
            <span className="gate-otp-label" id="gate-day-label">日</span>
            <InputOTPGroup className="gate-otp-group" role="group" aria-labelledby="gate-day-label">
              <InputOTPSlot index={2} className="gate-slot" />
              <InputOTPSlot index={3} className="gate-slot" />
            </InputOTPGroup>
          </div>
        </div>
      </InputOTP>
    </>
  );
}

export default function PassphraseGate() {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <Card className="gate-card ui">
      <Postmark id="gate-mark" className="gate-postmark" dated={false} />
      <CardHeader className="gate-header">
        <CardTitle className="gate-title">
          <h2 className="gate-title-text" id="gate-title">我们，是从哪天开始的？</h2>
        </CardTitle>
        <CardDescription className="gate-hint" id="gate-hint">月和日，四位数字</CardDescription>
      </CardHeader>
      <CardContent className="gate-content">
        <form ref={formRef} className="gate-form" data-gate-form noValidate>
          <PassphraseDateInput formRef={formRef} />
          <div className="gate-password" data-gate-password-panel hidden>
            <Label htmlFor="editor-password">共同手账的密码</Label>
            <Input id="editor-password" data-gate-password type="password" autoComplete="current-password" maxLength={128} />
            <button className={buttonVariants({ variant: 'default' })} type="submit">解锁手账</button>
          </div>
          <p className="gate-error" id="gate-error" data-gate-error role="alert" />
        </form>
      </CardContent>
      <CardContent className="gate-content gate-footer">
        <button className={`${buttonVariants({ variant: 'default' })} gate-retry`} type="button" data-gate-retry hidden>重试退出</button>
        <button className={`${buttonVariants({ variant: 'ghost' })} gate-visit`} type="button" data-gate-visit>访客浏览</button>
      </CardContent>
    </Card>
  );
}
