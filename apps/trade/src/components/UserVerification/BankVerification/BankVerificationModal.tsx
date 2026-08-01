import React, { useRef, FC, useEffect, useState } from "react";
import { Grid, Button, Box } from "@mui/material";
import TextView from "@/components/UI/TextView/TextView";
import CustomModal from "../../CustomModals/newModal/CustomModal";
import * as Yup from "yup";
import { useFormik } from "formik";
import { Regx } from "@/utils/constants";
import BasicTextFields from "@/components/UI/CustomInput/BasicTextFields";

import PropTypes from "prop-types";
import { CheckBankUserName, CheckIFSCCode } from "@/frontend-api-service/Api";
interface BankVerificationModalProps {
  IsOpen: boolean;
  handelClose: () => void;
  action: (values: object) => void;
  attemptsLeft: number;
  setIsLoader: {
    id: string;
    open: boolean;
    type: string;
    title: string;
    primaryMessage: string;
    secondaryMessage: string;
  };
}
const BankVerificationModal: FC<BankVerificationModalProps> = ({ IsOpen, handelClose, action, attemptsLeft, setIsLoader }) => {
  const FormSubmit = useRef<HTMLButtonElement | null>(null);

  const formik = useFormik({
    initialValues: {
      accountHoldersName: "",
      accountNumber: "",
      ifsc: ""
    },
    onSubmit: (values) => {
      action({
        ...values,
        accountNumber: values.accountNumber.toString()
      });
    },

    validationSchema: Yup.object({
      accountHoldersName: Yup.string().required("Name as per your bank account is mandatory").matches(Regx.alfabetsRegExp, "Only alphabets are allowed for this field"),
      accountNumber: Yup.string().required("Account number is required").matches(Regx.NumberRegex, "Invalid Account number"),
      ifsc: Yup.string().required("IFSC code is required").matches(Regx.ifscRegExp, "Invalid IFSC Code")
    })
  });
  const [activeStep, setActiveStep] = useState(0);
  const [isNameValid, setIsNameValid] = useState(false);
  const [BankDetail, setBankDetail] = useState({
    branchName: "",
    bankName: "",
    isVerified: false
  });
  const FormDataSubmit = () => {
    // FormSubmit.current?.click();
    if (activeStep === 0) {
      setIsNameValid(false);
      setBankDetail({ ...BankDetail, isVerified: false });
      CheckBankUserName(formik.values.accountHoldersName)
        .then((res: any) => {
          if (res?.data?.matchResult) {
            setIsNameValid(res?.data?.matchResult);
          } else {
            formik.setErrors({
              accountHoldersName: "Name is not as per PAN"
            });
          }
        })
        .catch((err: any) => console.log(err));
      CheckIFSCCode(formik.values.ifsc)
        .then((res: any) => {
          if (res.data.verified) {
            setBankDetail({ ...BankDetail, branchName: res?.data?.data?.branch, bankName: res?.data?.data?.bank, isVerified: res.data.verified });
            // formik.setFieldValue("bankName", res?.data?.data?.bank);
          } else {
            formik.setErrors({
              ifsc: "invalid IFSC"
            });
          }
        })
        .catch((err: any) => console.log(err));
    } else {
      formik.handleSubmit();
      setActiveStep(0);
      handelClose();
      setTimeout(() => {
        formik.handleReset();
      }, 0);
    }
  };

  useEffect(() => {
    formik.handleReset();
    return () => {
      formik.handleReset();
    };
  }, []);
  useEffect(() => {
    if (isNameValid && BankDetail.isVerified) {
      setActiveStep(1);
    }
  }, [isNameValid, BankDetail.isVerified]);
  return (
    <CustomModal
      primaryName={activeStep === 0 ? "Submit" : "Confirm"}
      isClose={true}
      primaryAction={FormDataSubmit}
      isPrimaryAction={true}
      // isloading={!isNameValid && !BankDetail.isVerified}
      primaryDisabled={attemptsLeft === 0}
      isSecondaryAction={true}
      secondaryName={activeStep === 0 ? "Dismiss" : "Edit"}
      secondaryAction={() => {
        if (activeStep === 0) {
          formik.handleReset();
          handelClose();
        } else {
          setActiveStep(0);
        }
      }}
      ContainerSx={{
        maxWidth: { sm: "460px", xs: "320px", lg: "500px", md: "460px" }
      }}
      IsOpen={IsOpen}
      close={() => {
        formik.handleReset();
        handelClose();
        setActiveStep(0);
      }}
    >
      <Grid item p={1.2}>
        <TextView component={"p"} variant="Medium_16" text={activeStep === 0 ? "Bank Verification" : "Confirm Bank Account Details"} />
        {activeStep === 1 && <TextView color={"text.quaternary"} component={"p"} variant="Regular_12" text={"Make sure your all your bank account details provided are correct."} />}
        {activeStep === 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <TextView color={attemptsLeft <= 1 ? "text.errorDefault" : "text.quaternary"} component={"p"} variant="Regular_12" text={`You have ${attemptsLeft} Attempts Left.`} />
            <TextView
              onClick={() => {
                if (attemptsLeft === 0) {
                  setIsLoader({
                    id: "",
                    open: true,
                    type: "Bank Attempt Error",
                    title: "",
                    primaryMessage: "",
                    secondaryMessage: ""
                  });
                }
              }}
              style={{ textDecoration: "underline", cursor: attemptsLeft <= 1 && "pointer" }}
              color={attemptsLeft <= 1 ? "text.primary" : "text.quaternary"}
              component={"p"}
              variant="Regular_12"
              text={`Learn More`}
            />
          </Box>
        )}
      </Grid>
      {activeStep === 0 && (
        <form onSubmit={formik.handleSubmit}>
          <Grid container sx={{ p: 1 }}>
            <Grid item xs={12}>
              <BasicTextFields
                name="accountHoldersName"
                value={formik.values.accountHoldersName.toUpperCase()}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                errorText={formik.touched.accountHoldersName ? formik.errors.accountHoldersName : ""}
                type="text"
                label="Account Holder Name "
                placeholder={"NAME XYZ"}
              />
            </Grid>
            <Grid item xs={12} sx={{ marginTop: "14px" }}>
              <BasicTextFields
                name="accountNumber"
                value={formik.values.accountNumber}
                onChange={formik.handleChange}
                errorText={formik.touched.accountNumber ? formik.errors.accountNumber : ""}
                type="text"
                label="Account Number"
                placeholder={"123456789"}
              />
            </Grid>
            <Grid item xs={12} sx={{ marginTop: "14px" }}>
              <BasicTextFields
                name="ifsc"
                value={formik.values.ifsc.toUpperCase()}
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                variant="outlined"
                type="text"
                label="IFSC Code"
                placeholder={"ABC 123"}
                errorText={formik.touched.ifsc ? formik.errors.ifsc : ""}
              />
            </Grid>
            <Button sx={{ display: "none" }} type="submit" ref={FormSubmit}></Button>
          </Grid>
        </form>
      )}

      {activeStep === 1 && (
        <Grid container sx={{ p: 1 }}>
          <Grid gap={0.1} style={{ border: "1px solid #1B1B1F", padding: "20px 14px", borderRadius: "4px", backgroundColor: "#29292E", alignItems: "flex-start" }} item xs={12}>
            <TextView color={"text.secondary"} component={"p"} variant="labelSmall" text={"Account Holder Name"} />
            <TextView color={"text.primary"} component={"p"} variant="Bold_12" text={formik?.values?.accountHoldersName} />
          </Grid>

          <Grid gap={0.1} style={{ border: "1px solid #1B1B1F", padding: "20px 14px", borderRadius: "4px", backgroundColor: "#29292E", alignItems: "flex-start", marginTop: "8px" }} item xs={12}>
            <TextView color={"text.secondary"} component={"p"} variant="labelSmall" text={"Account Number"} />
            <TextView color={"text.primary"} component={"p"} variant="Bold_12" text={formik?.values?.accountNumber} />
          </Grid>

          <Grid gap={0.1} style={{ border: "1px solid #1B1B1F", padding: "20px 14px", borderRadius: "4px", backgroundColor: "#29292E", alignItems: "flex-start", marginTop: "8px" }} item xs={12}>
            <TextView color={"text.secondary"} component={"p"} variant="labelSmall" text={"IFSC Code"} />
            <TextView color={"text.primary"} component={"p"} variant="Bold_12" text={formik?.values?.ifsc} />
          </Grid>

          <Grid gap={0.1} style={{ border: "1px solid #1B1B1F", padding: "20px 14px", borderRadius: "4px", backgroundColor: "#29292E", alignItems: "flex-start", marginTop: "8px" }} item xs={12}>
            <TextView color={"text.secondary"} component={"p"} variant="labelSmall" text={"Branch Name"} />
            <TextView color={"text.primary"} component={"p"} variant="Bold_12" text={BankDetail.branchName} />
          </Grid>

          <Button sx={{ display: "none" }} type="submit" ref={FormSubmit}></Button>
        </Grid>
      )}
    </CustomModal>
  );
};

BankVerificationModal.propTypes = {
  IsOpen: PropTypes.bool.isRequired,
  handelClose: PropTypes.func.isRequired,
  action: PropTypes.func.isRequired
};

export default BankVerificationModal;
