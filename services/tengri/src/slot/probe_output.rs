#[derive(Default)]
pub(super) struct ProbeOutput(Vec<u8>);

impl ProbeOutput {
    pub(super) fn append(&mut self, data: &[u8]) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.0.len() + data.len() <= 1 << 20,
            "probe output exceeded its limit"
        );
        self.0.extend_from_slice(data);
        Ok(())
    }

    pub(super) fn take_marker(&mut self, marker: &[u8]) -> bool {
        let Some(offset) = self
            .0
            .windows(marker.len())
            .position(|window| window == marker)
        else {
            return false;
        };
        self.0.drain(..offset + marker.len());
        true
    }

    pub(super) fn diagnostic_tail(&self) -> String {
        String::from_utf8_lossy(&self.0[self.0.len().saturating_sub(4096)..]).into_owned()
    }
}

#[test]
fn markers_received_during_heartbeats_remain_available() {
    let mut output = ProbeOutput::default();
    output.append(b"\x1eTENGRI_IO_END_124\x1f").unwrap();
    output.append(b"shell prompt").unwrap();
    assert!(output.take_marker(b"\x1eTENGRI_IO_END_124\x1f"));
    assert!(!output.take_marker(b"\x1eTENGRI_IO_END_124\x1f"));
}

#[test]
fn split_and_coalesced_markers_keep_the_remaining_output() {
    let mut output = ProbeOutput::default();
    output.append(b"prompt\x1eFIRST").unwrap();
    assert!(!output.take_marker(b"\x1eFIRST\x1f"));
    output.append(b"\x1f\x1eSECOND\x1f").unwrap();
    assert!(output.take_marker(b"\x1eFIRST\x1f"));
    assert!(output.take_marker(b"\x1eSECOND\x1f"));
}

#[test]
fn accumulated_probe_output_keeps_its_byte_bound() {
    let mut output = ProbeOutput::default();
    output.append(&vec![b'x'; 1 << 20]).unwrap();
    assert!(output.append(b"x").is_err());
}

#[test]
fn failure_diagnostics_only_include_the_bounded_remaining_output() {
    let mut output = ProbeOutput::default();
    output.append(b"consumed\x1eREADY\x1f").unwrap();
    assert!(output.take_marker(b"\x1eREADY\x1f"));
    assert_eq!(output.diagnostic_tail(), "");
    output.append(&vec![b'x'; 4096]).unwrap();
    output.append(b"read failed").unwrap();
    let diagnostic = output.diagnostic_tail();
    assert_eq!(diagnostic.len(), 4096);
    assert!(diagnostic.ends_with("read failed"));
    assert!(!diagnostic.contains("consumed"));
}
